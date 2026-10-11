import { describe, expect, it } from "vitest";
import { isPlanned, parseCompetitor, parseCompetitorList, planCall } from "./sources";

describe("parseCompetitor", () => {
  it("reads a domain, a URL and a name", () => {
    expect(parseCompetitor("Acme.com")).toEqual({ id: "acme-com", name: "Acme", domain: "acme.com" });
    expect(parseCompetitor("https://www.globex.io/pricing")).toMatchObject({ domain: "globex.io" });
    expect(parseCompetitor("Initech Software")).toEqual({ id: "initech-software", name: "Initech Software" });
    expect(parseCompetitor("  ")).toBeNull();
  });
});

describe("parseCompetitorList", () => {
  it("splits lines, drops duplicates and skips a header row", () => {
    const list = parseCompetitorList("name,domain\nAcme Inc,acme.com\nglobex.io\nglobex.io\nInitech");
    expect(list.map((c) => c.id)).toEqual(["acme-com", "globex-io", "initech"]);
    expect(list[0]).toMatchObject({ name: "Acme Inc", domain: "acme.com" });
  });
});

describe("planCall", () => {
  const withDomain = { id: "a", name: "Acme", domain: "acme.com" };
  const nameOnly = { id: "b", name: "Initech" };
  it("uses the domain variant on Google when a domain exists", () => {
    const c = planCall(withDomain, "google");
    expect(isPlanned(c) && c.endpointId).toBe("searchapi-io-google-ads-transparency-center");
    expect(isPlanned(c) && c.input).toEqual({ engine: "google_ads_transparency_center", domain: "acme.com" });
  });
  it("searches Meta by company name, also for a competitor that has a domain", () => {
    const c = planCall(withDomain, "meta");
    expect(isPlanned(c) && c.endpointId).toBe("scrapecreators-facebook-adlibrary-company-ads-get");
    expect(isPlanned(c) && c.input).toEqual({ companyName: "Acme" });
  });
  it("falls back to the name variants", () => {
    const c = planCall(nameOnly, "linkedin");
    expect(isPlanned(c) && c.endpointId).toBe("scrapecreators-linkedin-ads-search");
  });
  it("skips Google without a domain and says why", () => {
    const c = planCall(nameOnly, "google");
    expect(isPlanned(c)).toBe(false);
    expect("reason" in c && c.reason).toMatch(/domain/);
  });
});
