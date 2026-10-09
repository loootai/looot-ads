import type { Competitor, Platform } from "./types";

/** One way to read one ad library. A platform has several; the first whose `needs` the competitor satisfies wins. */
export interface SourceVariant {
  /** The pinned endpoint. No provider fallback, so the quoted price is the price. */
  endpointId: string;
  /** The looot job this endpoint serves in the catalog overview. */
  jobId: string;
  /** What the competitor must have for this variant. */
  needs: "domain" | "name";
  /** List price in micro-dollars per call on 2026-10-10. The live catalog price replaces it at run time. */
  fallbackMicros: number;
  input(c: Competitor): Record<string, unknown>;
}

export interface SourceDef {
  platform: Platform;
  label: string;
  variants: SourceVariant[];
}

/**
 * The ad libraries this repo reads. Edit this table to change the endpoint behind a platform.
 * Prices and ids were read from the public looot catalog on 2026-10-10.
 */
export const SOURCE_DEFS: SourceDef[] = [
  {
    platform: "meta",
    label: "Meta (Facebook and Instagram)",
    variants: [
      { endpointId: "adyntel-facebook", jobId: "ads.meta.search", needs: "domain", fallbackMicros: 6420, input: (c) => ({ company_domain: c.domain }) },
      { endpointId: "scrapecreators-facebook-adlibrary-company-ads-get", jobId: "ads.meta.search", needs: "name", fallbackMicros: 1880, input: (c) => ({ companyName: c.name }) },
    ],
  },
  {
    platform: "google",
    label: "Google Ads Transparency Center",
    variants: [{ endpointId: "adyntel-google", jobId: "ads.google.advertiser.ads", needs: "domain", fallbackMicros: 6420, input: (c) => ({ company_domain: c.domain }) }],
  },
  {
    platform: "linkedin",
    label: "LinkedIn Ad Library",
    variants: [
      { endpointId: "adyntel-linkedin", jobId: "ads.linkedin.search", needs: "domain", fallbackMicros: 6420, input: (c) => ({ company_domain: c.domain }) },
      { endpointId: "scrapecreators-linkedin-ads-search", jobId: "ads.linkedin.search", needs: "name", fallbackMicros: 1880, input: (c) => ({ company: c.name }) },
    ],
  },
  {
    platform: "tiktok",
    label: "TikTok Ad Library",
    variants: [{ endpointId: "scrapecreators-tiktok-ad-library-search", jobId: "tiktok.ad-library.search", needs: "name", fallbackMicros: 1880, input: (c) => ({ advertiser_name: c.name }) }],
  },
];

export interface PlannedCall {
  competitorId: string;
  platform: Platform;
  endpointId: string;
  jobId: string;
  input: Record<string, unknown>;
}

export interface SkippedCall {
  competitorId: string;
  platform: Platform;
  reason: string;
}

/** Picks the variant for (competitor, platform). A domain beats a name when both exist. */
export function planCall(c: Competitor, platform: Platform, defs: SourceDef[] = SOURCE_DEFS): PlannedCall | SkippedCall {
  const def = defs.find((d) => d.platform === platform);
  if (!def) return { competitorId: c.id, platform, reason: `No source is configured for ${platform}.` };
  const v = def.variants.find((x) => (x.needs === "domain" ? Boolean(c.domain) : Boolean(c.name)));
  if (!v) return { competitorId: c.id, platform, reason: `${def.label} needs a domain for ${c.name}; add one to include it.` };
  return { competitorId: c.id, platform, endpointId: v.endpointId, jobId: v.jobId, input: v.input(c) };
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

/** Splits a comma, semicolon or newline list (or CSV with a header row) into unique competitors. */
export function parseCompetitorList(raw: string): Competitor[] {
  const seen = new Set<string>();
  const out: Competitor[] = [];
  const lines = raw.split(/\r?\n/);
  const first = lines[0]?.toLowerCase().replace(/"/g, "").trim() ?? "";
  const body = /^(name|domain|competitor|company)s?(,|$)/.test(first) ? lines.slice(1) : lines;
  for (const line of body) {
    const cells = line.split(/[,;]/).map((s) => s.replace(/^"|"$/g, "").trim()).filter(Boolean);
    // "Acme Inc, acme.com" on one row is one competitor with both; a bare list of domains or names is many.
    const domainCell = cells.find((s) => DOMAIN_RE.test(s));
    const nameCell = cells.find((s) => !DOMAIN_RE.test(s));
    const rows = cells.length === 2 && domainCell && nameCell ? [{ name: nameCell, domain: domainCell }] : cells.map((s) => ({ name: s, domain: undefined as string | undefined }));
    for (const r of rows) {
      const c = parseCompetitor(r.domain ?? r.name);
      if (!c) continue;
      if (r.domain) c.name = r.name;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}
