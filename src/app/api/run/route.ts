import { NextResponse } from "next/server";
import { z } from "zod";
import { budgetFieldError } from "@/lib/budget";
import { getBudget } from "@/lib/budgetService";
import { allow, retryAfter } from "@/lib/auth/limits";
import { requireAdminRoute, sessionIdOf } from "@/lib/auth/guard";
import { pullDigest, verifyQuoteToken } from "@/lib/auth/session";
import { IS_DEMO, today } from "@/lib/clock";
import { usd } from "@/lib/money";
import { hasLoootToken, loootFromEnv } from "@/lib/looot";
import { fetchPrices } from "@/lib/prices";
import { buildPlan, chargeableMicros, runPlan } from "@/lib/runner";
import { serverCapMicros } from "@/lib/spend";
import { parseCompetitorList } from "@/lib/sources";
import { saveReport } from "@/lib/store";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The spend cap, the budget and the confirmed total are not fields. The server sets the cap, and the total lives inside the signed quoteToken. */
const Body = z.object({
  competitors: z.string().min(1).max(20_000),
  platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).min(1),
  quoteToken: z.string().min(1).max(200),
});

/** 6 paid runs per session per hour. */
const RUN_LIMIT = 6;
const RUN_WINDOW_MS = 60 * 60_000;

/**
 * Admin. Paid. Runs the plan the person confirmed. Refuses in demo mode, without a token, without a quote token
 * this server signed for this session and this pull, or when the live price rose above the quoted total.
 */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  if (IS_DEMO) return NextResponse.json({ error: "Demo mode makes no looot call." }, { status: 403 });
  if (!hasLoootToken()) return NextResponse.json({ error: "LOOOT_TOKEN is not set on the server." }, { status: 501 });
  const sid = await sessionIdOf(req.headers);
  if (!sid) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const raw = await req.json().catch(() => null);
  const refused = budgetFieldError(raw);
  if (refused) return NextResponse.json({ error: refused }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const competitors = parseCompetitorList(parsed.data.competitors.replace(/,/g, "\n"));
  if (competitors.length === 0) return NextResponse.json({ error: "No competitor found in that text." }, { status: 400 });
  const digest = await pullDigest(competitors.map((c) => c.id), parsed.data.platforms);
  const quotedMicros = await verifyQuoteToken(process.env, sid, digest, parsed.data.quoteToken);
  if (quotedMicros === null) return NextResponse.json({ error: "Get a new price first. The quote is missing, expired, or for a different pull." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  if (!allow(`run:${sid}`, RUN_LIMIT, RUN_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many paid runs this hour." }, { status: 429, headers: { "Retry-After": String(retryAfter(`run:${sid}`)), "Cache-Control": "no-store" } });
  }
  const priced = await fetchPrices();
  const plan = buildPlan(competitors, parsed.data.platforms as never, priced.prices, serverCapMicros());
  if (plan.totalMicros > quotedMicros) {
    return NextResponse.json({ error: "The price changed since you confirmed it. Quote again.", plan }, { status: 409 });
  }
  // Check order: quote (above), per-run cap, period budget, then the calls. Runs that ended since last time settle first.
  const looot = loootFromEnv();
  const budget = getBudget();
  await budget.reconcile(looot).catch(() => undefined);
  const room = await budget.status();
  const toCharge = await chargeableMicros(plan, budget);
  if (toCharge > room.remainingMicros) {
    return NextResponse.json(
      { error: `The quote (${usd(toCharge)}) is above what is left of the budget (${usd(room.remainingMicros)}: ${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month). Nothing was called. Raise the budget on the Costs page, or wait for the period to roll over.`, code: "budget" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const report = await runPlan({ competitors, plan, looot, unpriced: priced.unread, today: today(), ledger: budget });
  saveReport(report);
  return NextResponse.json({ ok: true, ads: report.ads.length, spendMicros: report.spendMicros, runs: report.runs });
}
