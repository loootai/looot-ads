import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, type CliDeps } from "@/cli/main";
import type { LoootRun, LoootRunner } from "./looot";
import { parseAds } from "./normalize";
import { ENDPOINT_IDS, FALLBACK_PRICES, fetchPrices, priceOfItem } from "./prices";
import { buildPlan, idempotencyKey, runPlan } from "./runner";
import { SOURCE_DEFS, defaultPlatforms, isPlanned, parseCompetitorList, planCall } from "./sources";
import { PLATFORMS, PLATFORM_LABEL } from "./types";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const TODAY = "2026-10-10";
const kw = { id: "kw-crm-software", name: "crm software", keyword: true };
const named = { id: "acme-com", name: "Acme", domain: "acme.com" };
const withHandle = { id: "contoso", name: "Contoso", handle: "contoso_example" };

describe("parseCompetitorList with keywords and handles", () => {
  it("reads kw: lines as keywords, not competitors", () => {
    const list = parseCompetitorList("kw: crm software\nkw:invoice automation\nacme.com");
    expect(list).toEqual([
      { id: "kw-crm-software", name: "crm software", keyword: true },
      { id: "kw-invoice-automation", name: "invoice automation", keyword: true },
      { id: "acme-com", name: "Acme", domain: "acme.com" },
    ]);
  });
  it("reads an @handle cell next to a name and a domain", () => {
    const [c] = parseCompetitorList("Contoso Inc, contoso.com, @contoso_example");
    expect(c).toMatchObject({ name: "Contoso Inc", domain: "contoso.com", handle: "contoso_example" });
  });
  it("reads a lone @handle as a competitor with a handle", () => {
    const [c] = parseCompetitorList("@contoso_example");
    expect(c).toMatchObject({ handle: "contoso_example" });
  });
});

describe("keyword discovery plans", () => {
  it("queries Meta, LinkedIn, TikTok, Reddit and TikTok Creative Center by keyword", () => {
    const pick = (p: Parameters<typeof planCall>[1]) => {
      const c = planCall(kw, p, SOURCE_DEFS, TODAY);
      return isPlanned(c) ? { e: c.endpointId, j: c.jobId, i: c.input } : null;
    };
    expect(pick("meta")).toEqual({ e: "scrapecreators-facebook-adlibrary-search-ads-get", j: "ads.meta.search", i: { query: "crm software" } });
    expect(pick("linkedin")).toEqual({ e: "scrapecreators-linkedin-ads-search", j: "ads.linkedin.search", i: { keyword: "crm software" } });
    expect(pick("tiktok")).toEqual({ e: "scrapecreators-tiktok-ad-library-search", j: "tiktok.ad-library.search", i: { query: "crm software" } });
    expect(pick("reddit")).toEqual({ e: "searchapi-io-reddit-ad-library", j: "search.reddit-ad-library", i: { engine: "reddit_ad_library", q: "crm software" } });
    expect(pick("tiktoktop")).toMatchObject({ e: "tikhub-api-tiktok-ads-search-ads", j: "api.tiktok.ads.search-ads", i: { keyword: "crm software", limit: 20, page: 1 } });
  });
  it("skips Google and X for a keyword and says why", () => {
    for (const p of ["google", "x"] as const) {
      const c = planCall(kw, p, SOURCE_DEFS, TODAY);
      expect(isPlanned(c)).toBe(false);
      expect("reason" in c && c.reason).toMatch(/keyword/);
    }
  });
  it("does not send a named competitor to Reddit or the Creative Center", () => {
    for (const p of ["reddit", "tiktoktop"] as const) {
      const c = planCall(named, p, SOURCE_DEFS, TODAY);
      expect(isPlanned(c)).toBe(false);
      expect("reason" in c && c.reason).toMatch(/keyword/);
    }
  });
  it("never sends a keyword to a competitor lookup", () => {
    const c = planCall(kw, "meta", SOURCE_DEFS, TODAY);
    expect(isPlanned(c) && c.endpointId).not.toBe("scrapecreators-facebook-adlibrary-company-ads-get");
  });
});

describe("X ads by handle", () => {
  it("needs a handle and asks for 20 results over the 365 days before the current 7-day period", () => {
    const c = planCall(withHandle, "x", SOURCE_DEFS, TODAY);
    expect(isPlanned(c) && c.endpointId).toBe("anysite-api-twitter-ads-search");
    expect(isPlanned(c) && c.jobId).toBe("api.twitter.ads.search");
    expect(isPlanned(c) && c.input).toEqual({ advertiser: "contoso_example", count: 20, start_date: "2025-10-08", end_date: "2026-10-08" });
    const none = planCall(named, "x", SOURCE_DEFS, TODAY);
    expect(isPlanned(none)).toBe(false);
    expect("reason" in none && none.reason).toMatch(/handle/);
  });
});

describe("defaults and prices", () => {
  it("keeps the four original platforms for a named competitor and adds X when a handle exists", () => {
    expect(defaultPlatforms(named)).toEqual(["meta", "google", "linkedin", "tiktok"]);
    expect(defaultPlatforms(withHandle)).toEqual(["meta", "google", "linkedin", "tiktok", "x"]);
    expect(defaultPlatforms(kw)).toEqual(["meta", "linkedin", "tiktok", "reddit", "tiktoktop"]);
  });
  it("lists every platform with a label", () => {
    expect(PLATFORMS).toEqual(["meta", "google", "linkedin", "tiktok", "reddit", "x", "tiktoktop"]);
    for (const p of PLATFORMS) expect(PLATFORM_LABEL[p]).toBeTruthy();
  });
  it("has the catalog list prices in the fallback map", () => {
    expect(FALLBACK_PRICES["searchapi-io-reddit-ad-library"]).toBe(4000);
    expect(FALLBACK_PRICES["tikhub-api-tiktok-ads-search-ads"]).toBe(1000);
    expect(FALLBACK_PRICES["scrapecreators-facebook-adlibrary-search-ads-get"]).toBe(1880);
    expect(FALLBACK_PRICES["anysite-api-twitter-ads-search"]).toBe(360 * 20);
    for (const id of ENDPOINT_IDS) expect(FALLBACK_PRICES[id]).toBeGreaterThan(0);
  });
  it("prices one keyword on its five platforms at 3 x 1880 + 4000 + 1000 micros", () => {
    const plan = buildPlan([kw], undefined, FALLBACK_PRICES, 1_000_000, SOURCE_DEFS, TODAY);
    expect(plan.lines.map((l) => l.platform)).toEqual(["meta", "linkedin", "tiktok", "reddit", "tiktoktop"]);
    expect(plan.totalMicros).toBe(10_640);
    expect(plan.skipped).toEqual([]);
  });
  it("prices a competitor with a domain on the original four at 1880 x 3 + 4000 micros", () => {
    const plan = buildPlan([named], undefined, FALLBACK_PRICES, 1_000_000, SOURCE_DEFS, TODAY);
    expect(plan.lines.map((l) => l.endpointId)).toEqual(["scrapecreators-facebook-adlibrary-company-ads-get", "searchapi-io-google-ads-transparency-center", "scrapecreators-linkedin-ads-search", "scrapecreators-tiktok-ad-library-search"]);
    expect(plan.totalMicros).toBe(9_640);
  });
  it("never plans an Adyntel endpoint, which the public catalog no longer lists", () => {
    expect(ENDPOINT_IDS.filter((id) => id.startsWith("adyntel"))).toEqual([]);
  });
  it("prices a per-result endpoint as result count x unit price", () => {
    expect(priceOfItem({ price: { state: "known", amountMicros: 360, unit: "result" } }, 20)).toBe(7200);
    expect(priceOfItem({ price: { state: "known", amountMicros: 360, unit: "result" } })).toBeNull();
    expect(priceOfItem({ price: { state: "known", amountMicros: 1000, unit: "call" } }, 20)).toBe(1000);
  });
  it("reads the live per-result price and multiplies it", async () => {
    const f = (async () => new Response(JSON.stringify({ price: { state: "known", amountMicros: 400, unit: "result" } }))) as unknown as typeof fetch;
    const r = await fetchPrices(["anysite-api-twitter-ads-search"], { fetch: f });
    expect(r.prices["anysite-api-twitter-ads-search"]).toBe(8000);
    expect(r.unread).toEqual([]);
  });
});

describe("parsers on the fixtures", () => {
  const base = { competitorId: "kw-crm-software", today: TODAY };
  it("reads a Meta keyword search with the advertiser page name", () => {
    const ads = parseAds(fixture("metaKeywordSearch.json"), { ...base, platform: "meta", jobId: "ads.meta.search" });
    expect(ads).toHaveLength(2);
    expect(ads[0]).toMatchObject({ id: "900000000001", advertiser: "Northwind Example Co", status: "active", headline: "Close the books in 3 days", cta: "Sign Up", thumbnailUrl: "https://cdn.example/nw1.jpg" });
    expect(ads[1]).toMatchObject({ advertiser: "Contoso Example", status: "inactive", format: "video", mediaUrl: "https://cdn.example/c2.mp4" });
  });
  it("reads Google Ads Transparency creatives that carry only a format, dates and a library link", () => {
    const ads = parseAds(fixture("googleAdsTransparency.json"), { competitorId: "northfield", platform: "google", jobId: "search.google-ads-transparency-center", today: TODAY });
    expect(ads).toHaveLength(2);
    expect(ads[0]).toMatchObject({ id: "CR00000000000000000001", advertiser: "Northfield Example Inc", format: "text", status: "inactive", firstSeen: "2026-05-02", lastSeen: "2026-10-09", runningDays: 160, libraryUrl: "https://adstransparency.google.com/advertiser/AR00000000000000000001/creative/CR00000000000000000001" });
    expect(ads[0].landingUrl).toBeUndefined();
    expect(ads[1]).toMatchObject({ format: "image", thumbnailUrl: "https://cdn.example/g2.png" });
  });
  it("reads Reddit ads, with the advertiser as an object or a string", () => {
    const ads = parseAds(fixture("redditAdLibrary.json"), { ...base, platform: "reddit", jobId: "search.reddit-ad-library" });
    expect(ads).toHaveLength(2);
    expect(ads[0]).toMatchObject({ id: "t3_example1", advertiser: "Fabrikam Example", headline: "A CRM your team will actually open", cta: "Learn more", landingUrl: "https://fabrikam.example/crm", firstSeen: "2026-09-14" });
    expect(ads[1]).toMatchObject({ advertiser: "Adventure Works Example", headline: "Stop pasting leads into a sheet" });
  });
  it("reads TikTok Creative Center top ads from data.materials", () => {
    const ads = parseAds(fixture("tiktokTopAds.json"), { ...base, platform: "tiktoktop", jobId: "api.tiktok.ads.search-ads" });
    expect(ads).toHaveLength(2);
    expect(ads[0]).toMatchObject({ id: "7100000000000000001", advertiser: "Wide World Example", headline: "POV: your CRM updates itself", thumbnailUrl: "https://cdn.example/tt1.jpg", mediaUrl: "https://cdn.example/tt1.mp4", format: "video" });
    expect(ads[1].thumbnailUrl).toBe("https://cdn.example/tt2.jpg");
  });
  it("reads X promoted tweets and keeps the tweet link as the library link", () => {
    const ads = parseAds(fixture("xAdsRepository.json"), { competitorId: "contoso", platform: "x", jobId: "api.twitter.ads.search", today: TODAY });
    expect(ads).toHaveLength(2);
    expect(ads[0]).toMatchObject({ id: "1800000000000000001", advertiser: "contoso_example", body: "Q3 pricing is live. Switch before the 31st and keep your rate for 2 years.", libraryUrl: "https://x.com/contoso_example/status/1800000000000000001", status: "inactive", runningDays: 41 });
    expect(ads[1].body).toBe("See the new dashboard in action.");
  });
});

describe("a keyword run with mocked HTTP", () => {
  const ok = (runId: string, result: unknown, actualCost?: number): LoootRun => ({ runId, status: "completed", result, actualCost });
  const results: Record<string, unknown> = {
    "scrapecreators-facebook-adlibrary-search-ads-get": fixture("metaKeywordSearch.json"),
    "searchapi-io-reddit-ad-library": fixture("redditAdLibrary.json"),
    "tikhub-api-tiktok-ads-search-ads": fixture("tiktokTopAds.json"),
  };
  function mock() {
    const calls: { endpointId: string; input: Record<string, unknown>; key: string }[] = [];
    const looot: LoootRunner = { runAndWait: async (e, i, k) => { calls.push({ endpointId: e, input: i, key: k }); return ok(`r-${e}`, results[e] ?? { ads: [] }); } };
    return { calls, looot };
  }

  it("makes one call per platform, parses the ads and keeps the stable key", async () => {
    const plan = buildPlan([kw], undefined, FALLBACK_PRICES, 1_000_000, SOURCE_DEFS, TODAY);
    const { calls, looot } = mock();
    const report = await runPlan({ competitors: [kw], plan, looot, today: TODAY });
    expect(calls).toHaveLength(5);
    expect(calls[3].key).toBe(idempotencyKey("searchapi-io-reddit-ad-library", { engine: "reddit_ad_library", q: "crm software" }));
    expect(report.ads.map((a) => a.platform).sort()).toEqual(["meta", "meta", "reddit", "reddit", "tiktoktop", "tiktoktop"]);
    expect(report.runs.filter((r) => r.state === "completed")).toHaveLength(5);
    expect(report.summaries[0].adCount).toBe(6);
  });
  it("stops at the cap before a call it cannot afford", async () => {
    const plan = buildPlan([kw], undefined, FALLBACK_PRICES, 5_000, SOURCE_DEFS, TODAY);
    const { calls, looot } = mock();
    const report = await runPlan({ competitors: [kw], plan, looot, today: TODAY });
    expect(calls.map((c) => c.endpointId)).toEqual(["scrapecreators-facebook-adlibrary-search-ads-get", "scrapecreators-linkedin-ads-search", "tikhub-api-tiktok-ads-search-ads"]);
    expect(report.runs.filter((r) => r.state === "blocked").map((r) => r.platform)).toEqual(["tiktok", "reddit"]);
    expect(report.spendMicros).toBe(4_760);
  });
  it("does not call an X endpoint whose live per-result price could not be read", async () => {
    const plan = buildPlan([withHandle], ["x"], FALLBACK_PRICES, 1_000_000, SOURCE_DEFS, TODAY);
    const { calls, looot } = mock();
    const report = await runPlan({ competitors: [withHandle], plan, looot, unpriced: ["anysite-api-twitter-ads-search"], today: TODAY });
    expect(calls).toHaveLength(0);
    expect(report.runs[0].state).toBe("blocked");
  });
});

describe("cli --keywords", () => {
  function deps(over: Partial<CliDeps> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    return { d: { log: (s: string) => out.push(s), err: (s: string) => err.push(s), env: {}, ...over } as CliDeps, out, err };
  }
  it("prints the keyword plan with five calls and the total, and makes no call", async () => {
    const { d, out } = deps();
    expect(await main(["--keywords", "crm software", "--dry-run"], d)).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/searchapi-io-reddit-ad-library/);
    expect(text).toMatch(/tikhub-api-tiktok-ads-search-ads/);
    expect(text).toMatch(/5 calls, \$0\.01064 at list prices/);
  });
  it("mixes keywords and competitors, each on its own default platforms", async () => {
    const { d, out } = deps();
    expect(await main(["--keywords", "crm software", "--competitors", "acme.com", "--dry-run"], d)).toBe(0);
    expect(out.join("\n")).toMatch(/9 calls, \$0\.02028 at list prices/);
  });
  it("accepts the new platform names and rejects unknown ones", async () => {
    expect(await main(["--keywords", "crm", "--platforms", "reddit,x,tiktoktop", "--dry-run"], deps().d)).toBe(0);
    expect(await main(["--keywords", "crm", "--platforms", "myspace", "--dry-run"], deps().d)).toBe(2);
  });
});

describe("demo report", () => {
  it("shows a keyword and an X handle with their providers' endpoints and list prices", async () => {
    const { demoReport } = await import("@/demo/seed");
    const r = demoReport();
    const platforms = new Set(r.ads.map((a) => a.platform));
    for (const p of PLATFORMS) expect(platforms.has(p)).toBe(true);
    expect(r.competitors.some((c) => c.keyword)).toBe(true);
    expect(r.ads.filter((a) => a.competitorId.startsWith("kw-")).every((a) => a.advertiser)).toBe(true);
    for (const run of r.runs) expect(run.costMicros).toBe(FALLBACK_PRICES[run.endpointId]);
    expect(r.runs.find((x) => x.platform === "reddit")?.endpointId).toBe("searchapi-io-reddit-ad-library");
  });
});
