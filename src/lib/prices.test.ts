import { describe, expect, it } from "vitest";
import { ENDPOINT_IDS, FALLBACK_PRICES, fetchPrices, priceOfItem } from "./prices";

describe("priceOfItem", () => {
  it("reads a known per-call price", () => {
    expect(priceOfItem({ price: { state: "known", amountMicros: 4000, unit: "call" } })).toBe(4000);
  });
  it("returns null for unknown, negative or non-call prices", () => {
    expect(priceOfItem({ price: { state: "unknown" } })).toBeNull();
    expect(priceOfItem({ price: { state: "known", amountMicros: -1 } })).toBeNull();
    expect(priceOfItem({ price: { state: "known", amountMicros: 5, unit: "row" } })).toBeNull();
    expect(priceOfItem(null)).toBeNull();
  });
});

describe("fetchPrices", () => {
  it("uses the catalog price and lists what it could not read", async () => {
    const f = (async (url: string) => {
      if (url.endsWith("/scrapecreators-facebook-adlibrary-company-ads-get")) return new Response(JSON.stringify({ price: { state: "known", amountMicros: 7000, unit: "call" } }));
      if (url.endsWith("/searchapi-io-google-ads-transparency-center")) return new Response("{}", { status: 404 });
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await fetchPrices(["scrapecreators-facebook-adlibrary-company-ads-get", "searchapi-io-google-ads-transparency-center", "scrapecreators-linkedin-ads-search"], { fetch: f });
    expect(r.prices["scrapecreators-facebook-adlibrary-company-ads-get"]).toBe(7000);
    expect(r.prices["searchapi-io-google-ads-transparency-center"]).toBe(FALLBACK_PRICES["searchapi-io-google-ads-transparency-center"]);
    expect(r.unread.sort()).toEqual(["scrapecreators-linkedin-ads-search", "searchapi-io-google-ads-transparency-center"]);
    expect(r.source).toBe("fallback");
  });
  it("has a fallback price for every endpoint it can call", () => {
    for (const id of ENDPOINT_IDS) expect(FALLBACK_PRICES[id]).toBeGreaterThan(0);
  });
});
