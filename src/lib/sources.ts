import { today as clockToday } from "./clock";
import { PLATFORM_LABEL, type Competitor, type Platform } from "./types";

/** What a variant reads from the competitor row. "keyword" rows (kw: lines) only match keyword variants. */
export type Needs = "domain" | "name" | "keyword" | "handle";

/** One way to read one ad library. A platform has several; the first whose `needs` the row satisfies wins. */
export interface SourceVariant {
  /** The pinned endpoint. No provider fallback, so the quoted price is the price. */
  endpointId: string;
  /** The looot job this endpoint serves in the catalog overview. */
  jobId: string;
  /** Who runs the endpoint, as the catalog names the provider. Shown next to the price. */
  provider: string;
  /** What the row must have for this variant. */
  needs: Needs;
  /** List price in micro-dollars per call on 2026-10-11. The live catalog price replaces it at run time. For a per-result endpoint this is `resultCount` results. */
  fallbackMicros: number;
  /** Set when the catalog prices this endpoint per result. The price of one call is then the unit price times this count, and the input asks for exactly this many. */
  resultCount?: number;
  input(c: Competitor, ctx: { today: string }): Record<string, unknown>;
}

export interface SourceDef {
  platform: Platform;
  label: string;
  variants: SourceVariant[];
}

const DAY_MS = 86_400_000;

function daysBefore(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The ad libraries this repo reads. Edit this table to change the endpoint behind a platform.
 * Prices and ids were read from the public looot catalog on 2026-10-11. The Adyntel endpoints this table used before are no longer in that catalog, so a domain now only selects Google.
 */
export const SOURCE_DEFS: SourceDef[] = [
  {
    platform: "meta",
    label: "Meta (Facebook and Instagram)",
    variants: [
      { endpointId: "scrapecreators-facebook-adlibrary-company-ads-get", provider: "Scrape Creators", jobId: "ads.meta.search", needs: "name", fallbackMicros: 1880, input: (c) => ({ companyName: c.name }) },
      { endpointId: "scrapecreators-facebook-adlibrary-search-ads-get", provider: "Scrape Creators", jobId: "ads.meta.search", needs: "keyword", fallbackMicros: 1880, input: (c) => ({ query: c.name }) },
    ],
  },
  {
    platform: "google",
    label: "Google Ads Transparency Center",
    variants: [{ endpointId: "searchapi-io-google-ads-transparency-center", provider: "SearchApi", jobId: "search.google-ads-transparency-center", needs: "domain", fallbackMicros: 4000, input: (c) => ({ engine: "google_ads_transparency_center", domain: c.domain }) }],
  },
  {
    platform: "linkedin",
    label: "LinkedIn Ad Library",
    variants: [
      { endpointId: "scrapecreators-linkedin-ads-search", provider: "Scrape Creators", jobId: "ads.linkedin.search", needs: "name", fallbackMicros: 1880, input: (c) => ({ company: c.name }) },
      { endpointId: "scrapecreators-linkedin-ads-search", provider: "Scrape Creators", jobId: "ads.linkedin.search", needs: "keyword", fallbackMicros: 1880, input: (c) => ({ keyword: c.name }) },
    ],
  },
  {
    platform: "tiktok",
    label: "TikTok Ad Library",
    variants: [
      { endpointId: "scrapecreators-tiktok-ad-library-search", provider: "Scrape Creators", jobId: "tiktok.ad-library.search", needs: "name", fallbackMicros: 1880, input: (c) => ({ advertiser_name: c.name }) },
      { endpointId: "scrapecreators-tiktok-ad-library-search", provider: "Scrape Creators", jobId: "tiktok.ad-library.search", needs: "keyword", fallbackMicros: 1880, input: (c) => ({ query: c.name }) },
    ],
  },
  {
    platform: "reddit",
    label: "Reddit Ad Library",
    variants: [{ endpointId: "searchapi-io-reddit-ad-library", provider: "SearchApi", jobId: "search.reddit-ad-library", needs: "keyword", fallbackMicros: 4000, input: (c) => ({ engine: "reddit_ad_library", q: c.name }) }],
  },
  {
    platform: "x",
    label: "X Ads Repository (EU and EEA)",
    variants: [
      {
        endpointId: "anysite-api-twitter-ads-search", provider: "Anysite",
        jobId: "api.twitter.ads.search",
        needs: "handle",
        fallbackMicros: 360 * 20,
        resultCount: 20,
        input: (c, ctx) => ({ advertiser: c.handle, count: 20, start_date: daysBefore(ctx.today, 365), end_date: ctx.today }),
      },
    ],
  },
  {
    platform: "tiktoktop",
    label: "TikTok Creative Center (top ads)",
    variants: [{ endpointId: "tikhub-api-tiktok-ads-search-ads", provider: "TikHub", jobId: "api.tiktok.ads.search-ads", needs: "keyword", fallbackMicros: 1000, input: (c) => ({ keyword: c.name, limit: 20, page: 1, country_code: "US", period: 30, order_by: "for_you" }) }],
  },
];

/** Platforms a pull uses when the caller names none. Named competitors keep the original four, plus X when a handle is given. Keywords use the five that search by keyword. */
export function defaultPlatforms(c: Competitor): Platform[] {
  if (c.keyword) return ["meta", "linkedin", "tiktok", "reddit", "tiktoktop"];
  return c.handle ? ["meta", "google", "linkedin", "tiktok", "x"] : ["meta", "google", "linkedin", "tiktok"];
}

function satisfies(v: SourceVariant, c: Competitor): boolean {
  switch (v.needs) {
    case "keyword":
      return Boolean(c.keyword);
    case "domain":
      return !c.keyword && Boolean(c.domain);
    case "handle":
      return !c.keyword && Boolean(c.handle);
    default:
      return !c.keyword && Boolean(c.name);
  }
}

export interface PlannedCall {
  competitorId: string;
  platform: Platform;
  endpointId: string;
  jobId: string;
  provider: string;
  /** Set for a per-result endpoint: how many results the call asks for. The price is per result times this. */
  resultCount?: number;
  input: Record<string, unknown>;
}

export interface SkippedCall {
  competitorId: string;
  platform: Platform;
  reason: string;
}

/** Why a row has no call on a platform. Says what to add, in the repo's own terms. */
function skipReason(c: Competitor, def: SourceDef): string {
  if (c.keyword) return `${def.label} has no keyword search in the looot catalog. Name a competitor to include it.`;
  const needs = def.variants[0]?.needs;
  if (needs === "keyword") return `${def.label} is searched by keyword. Add "kw: ${c.name}" as a keyword to include it.`;
  if (needs === "handle") return `${def.label} needs the advertiser's handle for ${c.name}; add @handle to include it.`;
  return `${def.label} needs a domain for ${c.name}; add one to include it.`;
}

/** Picks the variant for (row, platform). A domain beats a name when both exist. A keyword row only matches keyword variants. */
export function planCall(c: Competitor, platform: Platform, defs: SourceDef[] = SOURCE_DEFS, today: string = clockToday()): PlannedCall | SkippedCall {
  const def = defs.find((d) => d.platform === platform);
  if (!def) return { competitorId: c.id, platform, reason: `No source is configured for ${PLATFORM_LABEL[platform]}.` };
  const v = def.variants.find((x) => satisfies(x, c));
  if (!v) return { competitorId: c.id, platform, reason: skipReason(c, def) };
  return { competitorId: c.id, platform, endpointId: v.endpointId, jobId: v.jobId, provider: v.provider, resultCount: v.resultCount, input: v.input(c, { today }) };
}

export function isPlanned(x: PlannedCall | SkippedCall): x is PlannedCall {
  return "endpointId" in x;
}

const DOMAIN_RE = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#].*)?$/i;

/** Turns "acme.com", "https://www.acme.com/pricing" or "Acme Inc" into a competitor. A domain gives a name too. */
export function parseCompetitor(raw: string): Competitor | null {
  const text = raw.trim();
  if (!text) return null;
  const m = DOMAIN_RE.exec(text);
  if (m) {
    const domain = m[1].toLowerCase();
    const stem = domain.split(".")[0];
    return { id: domain.replace(/[^a-z0-9]+/g, "-"), name: stem.charAt(0).toUpperCase() + stem.slice(1), domain };
  }
  return { id: text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name: text };
}

const HANDLE_RE = /(^|[\s,;])@(\w{1,15})(?=$|[\s,;])/;

/**
 * Splits a comma, semicolon or newline list (or CSV with a header row) into unique rows.
 * A line "kw: crm software" is a keyword to discover ads for. "@handle" on a line sets the X handle of that competitor.
 */
export function parseCompetitorList(raw: string): Competitor[] {
  const seen = new Set<string>();
  const out: Competitor[] = [];
  const lines = raw.split(/\r?\n/);
  const first = lines[0]?.toLowerCase().replace(/"/g, "").trim() ?? "";
  const body = /^(name|domain|competitor|company)s?(,|$)/.test(first) ? lines.slice(1) : lines;
  const push = (c: Competitor) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
  };
  for (const rawLine of body) {
    const kwMatch = /^\s*kw\s*:\s*(.*)$/i.exec(rawLine);
    if (kwMatch) {
      const text = kwMatch[1].replace(/\s+/g, " ").trim();
      const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (slug) push({ id: `kw-${slug}`, name: text, keyword: true });
      continue;
    }
    const handleMatch = HANDLE_RE.exec(rawLine);
    const handle = handleMatch?.[2];
    const line = handleMatch ? rawLine.replace(HANDLE_RE, "$1") : rawLine;
    const cells = line.split(/[,;]/).map((s) => s.replace(/^"|"$/g, "").trim()).filter(Boolean);
    if (cells.length === 0 && handle) {
      push({ id: handle.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: handle, handle });
      continue;
    }
    // "Acme Inc, acme.com" on one row is one competitor with both; a bare list of domains or names is many.
    const domainCell = cells.find((s) => DOMAIN_RE.test(s));
    const nameCell = cells.find((s) => !DOMAIN_RE.test(s));
    const rows = cells.length === 2 && domainCell && nameCell ? [{ name: nameCell, domain: domainCell }] : cells.map((s) => ({ name: s, domain: undefined as string | undefined }));
    for (const r of rows) {
      const c = parseCompetitor(r.domain ?? r.name);
      if (!c) continue;
      if (r.domain) c.name = r.name;
      if (handle && rows.length === 1) c.handle = handle;
      push(c);
    }
  }
  return out;
}
