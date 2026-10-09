import { describe, expect, it } from "vitest";
import { ENDPOINT_IDS, FALLBACK_PRICES, fetchPrices, priceOfItem } from "./prices";

describe("priceOfItem", () => {
  it("reads a known per-call price", () => {
    expect(priceOfItem({ price: { state: "known", amountMicros: 6420, unit: "call" } })).toBe(6420);
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
      if (url.endsWith("/adyntel-facebook")) return new Response(JSON.stringify({ price: { state: "known", amountMicros: 7000, unit: "call" } }));
      if (url.endsWith("/adyntel-google")) return new Response("{}", { status: 404 });
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await fetchPrices(["adyntel-facebook", "adyntel-google", "adyntel-linkedin"], { fetch: f });
    expect(r.prices["adyntel-facebook"]).toBe(7000);
    expect(r.prices["adyntel-google"]).toBe(FALLBACK_PRICES["adyntel-google"]);
    expect(r.unread.sort()).toEqual(["adyntel-google", "adyntel-linkedin"]);
    expect(r.source).toBe("fallback");
  });
  it("has a fallback price for every endpoint it can call", () => {
    for (const id of ENDPOINT_IDS) expect(FALLBACK_PRICES[id]).toBeGreaterThan(0);
  });
});
