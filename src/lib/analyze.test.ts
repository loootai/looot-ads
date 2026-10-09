import { describe, expect, it } from "vitest";
import { anglesOf, offersOf, summarize } from "./analyze";
import { DEMO_COMPETITORS, demoAds } from "@/demo/seed";

const base = { competitorId: "c", platform: "meta" as const, format: "image" as const, status: "active" as const, jobId: "j" };

describe("angles and offers", () => {
  it("finds angles by keyword", () => {
    expect(anglesOf({ ...base, id: "1", headline: "Save more", body: "Trusted by 4,000 teams. Cancel anytime." })).toEqual(expect.arrayContaining(["Price and savings", "Social proof", "Risk reversal"]));
  });
  it("finds offers by pattern", () => {
    expect(offersOf({ ...base, id: "2", body: "30% off. Limited time. Free trial. Book a demo." })).toEqual(expect.arrayContaining(["Percent off", "Free trial", "Demo or call", "Limited time"]));
  });
  it("finds nothing in neutral copy", () => {
    expect(anglesOf({ ...base, id: "3", headline: "Hello" })).toEqual([]);
  });
});

describe("summarize", () => {
  const ads = demoAds();
  it("counts ads, active ads, platforms and longest running", () => {
    const s = summarize(DEMO_COMPETITORS[0], ads);
    expect(s.adCount).toBe(7);
    expect(s.activeCount).toBe(5);
    expect(s.byPlatform).toMatchObject({ meta: 3, linkedin: 2, google: 1, tiktok: 1 });
    expect(s.longestRunning[0].days).toBe(188);
    expect(s.angles.length).toBeGreaterThan(2);
    expect(s.offers.map((o) => o.label)).toContain("Free trial");
  });
  it("returns an empty summary for a competitor with no ads", () => {
    const s = summarize({ id: "none", name: "None" }, ads);
    expect(s).toMatchObject({ adCount: 0, medianRunningDays: null, angles: [] });
  });
});
