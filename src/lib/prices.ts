import type { PriceMap } from "./spend";
import { SOURCE_DEFS } from "./sources";

/** Results per call for endpoints the catalog prices per result. The call asks for exactly this many. */
const RESULT_COUNTS: Record<string, number> = Object.fromEntries(SOURCE_DEFS.flatMap((s) => s.variants.flatMap((v) => (v.resultCount ? [[v.endpointId, v.resultCount]] : []))));

/** Date the fallback prices were read from the public catalog. */
export const PRICES_AS_OF = "2026-10-11";

/** Every endpoint id this app can call. */
export const ENDPOINT_IDS: string[] = [...new Set(SOURCE_DEFS.flatMap((s) => s.variants.map((v) => v.endpointId)))];

/** List prices in micro-dollars per call, dated PRICES_AS_OF. Used for --dry-run and when the catalog cannot be read. */
export const FALLBACK_PRICES: PriceMap = Object.fromEntries(SOURCE_DEFS.flatMap((s) => s.variants.map((v) => [v.endpointId, v.fallbackMicros])));

export interface PriceResult {
  prices: PriceMap;
  source: "catalog" | "fallback";
  /** Endpoints whose live price could not be read. The runner refuses to call them. */
  unread: string[];
}

interface CatalogItem {
  price?: { state?: string; amountMicros?: number; unit?: string } | null;
}

/**
 * Reads the price of one call in micros from one public catalog item. null when it has no known price.
 * A per-result price needs `resultCount`, the number of results the call asks for; the call then costs unit price times count.
 */
export function priceOfItem(item: CatalogItem | null | undefined, resultCount?: number): number | null {
  const p = item?.price;
  if (!p || p.state !== "known" || typeof p.amountMicros !== "number" || p.amountMicros < 0) return null;
  if (p.unit === "result") return resultCount && resultCount > 0 ? Math.round(p.amountMicros * resultCount) : null;
  if (p.unit && p.unit !== "call") return null;
  return Math.round(p.amountMicros);
}

/** Free, no token. Reads current prices for the given endpoints from the public catalog. */
export async function fetchPrices(endpointIds: string[] = ENDPOINT_IDS, opts: { baseUrl?: string; fetch?: typeof fetch } = {}): Promise<PriceResult> {
  const base = (opts.baseUrl ?? process.env.LOOOT_API_URL ?? "https://api.looot.ai").replace(/\/+$/, "");
  const f = opts.fetch ?? fetch;
  const prices: PriceMap = { ...FALLBACK_PRICES };
  const unread: string[] = [];
  await Promise.all(
    endpointIds.map(async (id) => {
      try {
        const res = await f(`${base}/v1/public-catalog/${encodeURIComponent(id)}`);
        const price = res.ok ? priceOfItem((await res.json()) as CatalogItem, RESULT_COUNTS[id]) : null;
        if (price === null) unread.push(id);
        else prices[id] = price;
      } catch {
        unread.push(id);
      }
    }),
  );
  return { prices, source: unread.length > 0 ? "fallback" : "catalog", unread };
}
