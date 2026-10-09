import { NextResponse } from "next/server";
import { z } from "zod";
import { IS_DEMO, today } from "@/lib/clock";
import { hasLoootToken, loootFromEnv } from "@/lib/looot";
import { fetchPrices } from "@/lib/prices";
import { buildPlan, runPlan } from "@/lib/runner";
import { parseCapUsd } from "@/lib/spend";
import { parseCompetitorList } from "@/lib/sources";
import { saveReport } from "@/lib/store";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  competitors: z.string().min(1),
  platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).min(1),
  maxSpendUsd: z.union([z.string(), z.number()]),
  /** The total the person saw in the quote and agreed to, in micro-dollars. A live total above it refuses the run. */
  confirmedTotalMicros: z.number().int().nonnegative(),
});

/** Paid. Runs the plan the person confirmed. Refuses in demo mode, without a token, or when the live price rose above the confirmed total. */
export async function POST(req: Request) {
  if (IS_DEMO) return NextResponse.json({ error: "Demo mode makes no looot call." }, { status: 403 });
  if (!hasLoootToken()) return NextResponse.json({ error: "LOOOT_TOKEN is not set on the server." }, { status: 501 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const competitors = parseCompetitorList(parsed.data.competitors.replace(/,/g, "\n"));
  let cap: number;
  try {
    cap = parseCapUsd(parsed.data.maxSpendUsd);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const priced = await fetchPrices();
  const plan = buildPlan(competitors, parsed.data.platforms as never, priced.prices, cap);
  if (plan.totalMicros > parsed.data.confirmedTotalMicros) {
    return NextResponse.json({ error: "The price changed since you confirmed it. Quote again.", plan }, { status: 409 });
  }
  const report = await runPlan({ competitors, plan, looot: loootFromEnv(), unpriced: priced.unread, today: today() });
  saveReport(report);
  return NextResponse.json({ ok: true, ads: report.ads.length, spendMicros: report.spendMicros, runs: report.runs });
}
