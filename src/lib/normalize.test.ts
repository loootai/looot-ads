import { describe, expect, it } from "vitest";
import { findAdArray, parseAds, toDay } from "./normalize";

const ctx = { competitorId: "acme", platform: "meta" as const, jobId: "ads.meta.search", today: "2026-10-10" };

describe("toDay", () => {
  it("reads ISO text, unix seconds and milliseconds", () => {
    expect(toDay("2026-09-01T10:00:00Z")).toBe("2026-09-01");
    expect(toDay(1788220800)).toBe("2026-09-01");
    expect(toDay(1788220800000)).toBe("2026-09-01");
    expect(toDay("1788220800")).toBe("2026-09-01");
  });
  it("rejects junk and impossible years", () => {
    expect(toDay("soon")).toBeUndefined();
    expect(toDay(12)).toBeUndefined();
    expect(toDay(null)).toBeUndefined();
  });
});

describe("findAdArray", () => {
  it("finds the list under common wrapper keys, nested", () => {
    expect(findAdArray({ results: [{ a: 1 }] })).toHaveLength(1);
    expect(findAdArray({ data: { ads: [{ a: 1 }, { a: 2 }] } })).toHaveLength(2);
    expect(findAdArray([{ a: 1 }])).toHaveLength(1);
  });
  it("returns [] for anything else", () => {
    expect(findAdArray({ message: "nope" })).toEqual([]);
    expect(findAdArray(null)).toEqual([]);
  });
});

describe("parseAds", () => {
  it("maps a Meta-style ad with a snapshot object", () => {
    const ads = parseAds(
      {
        results: [
          {
            ad_archive_id: "123",
            is_active: true,
            start_date: "2026-08-01",
            snapshot: { title: "Save time", body: { text: "Try free for 14 days" }, cta_text: "Sign Up", link_url: "https://acme.example/lp", display_format: "VIDEO", videos: [{ video_preview_image_url: "https://cdn.example/p.jpg", video_hd_url: "https://cdn.example/v.mp4" }] },
          },
        ],
      },
      ctx,
    );
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({ id: "123", status: "active", firstSeen: "2026-08-01", lastSeen: "2026-10-10", runningDays: 70, headline: "Save time", body: "Try free for 14 days", cta: "Sign Up", landingUrl: "https://acme.example/lp", format: "video", mediaUrl: "https://cdn.example/v.mp4" });
    expect(ads[0].thumbnailUrl).toBe("https://cdn.example/p.jpg");
  });

  it("maps a LinkedIn-style ad (ad_id, commentary, creative_type)", () => {
    const ads = parseAds({ ads: [{ ad_id: "li-1", advertiser: "Acme", commentary: "Book a demo today", creative_type: "SINGLE_IMAGE", image: "https://cdn.example/i.png", ad_url: "https://www.linkedin.com/ad-library/detail/li-1" }] }, { ...ctx, platform: "linkedin" });
    expect(ads[0]).toMatchObject({ id: "li-1", body: "Book a demo today", format: "image", libraryUrl: "https://www.linkedin.com/ad-library/detail/li-1" });
  });

  it("marks an ad with a past end date as inactive and counts its running days", () => {
    const [ad] = parseAds([{ id: "x", title: "T", start_date: 1788220800, end_date: 1789000000 }], ctx);
    expect(ad.status).toBe("inactive");
    expect(ad.runningDays).toBe(9);
  });

  it("does not keep a landing or library link that is not http(s), and ignores a non-library url", () => {
    const [ad] = parseAds([{ id: "y", title: "T", link_url: "javascript:alert(1)", url: "https://acme.example/not-the-library" }], ctx);
    expect(ad.landingUrl).toBeUndefined();
    expect(ad.libraryUrl).toBeUndefined();
  });

  it("skips empty rows, dedupes by id, and gives an id to ads that have none", () => {
    const ads = parseAds([{ foo: 1 }, { id: "d", title: "Same" }, { id: "d", title: "Same again" }, { title: "No id", body: "x" }], ctx);
    expect(ads.map((a) => a.id).slice(0, 1)).toEqual(["d"]);
    expect(ads).toHaveLength(2);
    expect(ads[1].id).toMatch(/^[0-9a-f]{12}$/);
  });
});
