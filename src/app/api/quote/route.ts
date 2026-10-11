import { NextResponse } from "next/server";
import { z } from "zod";
import { allow, retryAfter } from "@/lib/auth/limits";
import { requireAdminRoute, sessionIdOf } from "@/lib/auth/guard";
import { createQuoteToken, pullDigest } from "@/lib/auth/session";
import { IS_DEMO } from "@/lib/clock";
import { FALLBACK_PRICES, PRICES_AS_OF, fetchPrices } from "@/lib/prices";
import { buildPlan } from "@/lib/runner";
import { serverCapMicros } from "@/lib/spend";
import { parseCompetitorList } from "@/lib/sources";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The spend cap is not a field: the server decides it (ADS_SPEND_CAP_USD). Extra fields are ignored. */
const Body = z.object({ competitors: z.string().min(1).max(20_000), platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).min(1) });

/** 60 quotes per session per 10 minutes. A quote is free but it reads the live catalog. */
const QUOTE_LIMIT = 60;
const QUOTE_WINDOW_MS = 10 * 60_000;

/**
 * Admin. Free. Returns the calls a pull would make and what they cost, without calling looot for data.
 * Outside the demo the answer carries a signed quoteToken that /api/run requires.
 */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const sid = await sessionIdOf(req.headers);
  if (sid && !allow(`quote:${sid}`, QUOTE_LIMIT, QUOTE_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many quotes. Wait a few minutes." }, { status: 429, headers: { "Retry-After": String(retryAfter(`quote:${sid}`)), "Cache-Control": "no-store" } });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send competitors and at least one platform." }, { status: 400 });
  const competitors = parseCompetitorList(parsed.data.competitors.replace(/,/g, "\n"));
  if (competitors.length === 0) return NextResponse.json({ error: "No competitor found in that text." }, { status: 400 });
  const priced = IS_DEMO ? { prices: FALLBACK_PRICES, source: "fallback" as const, unread: [] } : await fetchPrices();
  const plan = buildPlan(competitors, parsed.data.platforms as never, priced.prices, serverCapMicros());
  const digest = await pullDigest(competitors.map((c) => c.id), parsed.data.platforms);
  const quoteToken = sid ? await createQuoteToken(process.env, sid, plan.totalMicros, digest) : null;
  return NextResponse.json({ competitors, plan, quoteToken, priceNote: priced.source === "catalog" ? "live catalog prices" : `list prices dated ${PRICES_AS_OF}`, unread: priced.unread, demo: IS_DEMO });
}
