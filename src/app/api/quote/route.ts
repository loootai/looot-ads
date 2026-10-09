import { NextResponse } from "next/server";
import { z } from "zod";
import { IS_DEMO } from "@/lib/clock";
import { FALLBACK_PRICES, PRICES_AS_OF, fetchPrices } from "@/lib/prices";
import { buildPlan } from "@/lib/runner";
import { parseCapUsd } from "@/lib/spend";
import { parseCompetitorList } from "@/lib/sources";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({ competitors: z.string().min(1), platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).min(1), maxSpendUsd: z.union([z.string(), z.number()]).default("1.00") });

/** Free. Returns the calls a pull would make and what they cost, without calling looot for data. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send competitors and at least one platform." }, { status: 400 });
  const competitors = parseCompetitorList(parsed.data.competitors.replace(/,/g, "\n"));
  if (competitors.length === 0) return NextResponse.json({ error: "No competitor found in that text." }, { status: 400 });
  let cap: number;
  try {
    cap = parseCapUsd(parsed.data.maxSpendUsd);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const priced = IS_DEMO ? { prices: FALLBACK_PRICES, source: "fallback" as const, unread: [] } : await fetchPrices();
  const plan = buildPlan(competitors, parsed.data.platforms as never, priced.prices, cap);
  return NextResponse.json({ competitors, plan, priceNote: priced.source === "catalog" ? "live catalog prices" : `list prices dated ${PRICES_AS_OF}`, unread: priced.unread, demo: IS_DEMO });
}
