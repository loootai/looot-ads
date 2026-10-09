import anglesConfig from "../../config/angles.json";
import type { Ad, AdFormat, Competitor, CompetitorSummary, Count, Platform } from "./types";

interface AngleConfig {
  angles: Record<string, string[]>;
  offers: { label: string; pattern: string }[];
}

const DEFAULT_CONFIG = anglesConfig as unknown as AngleConfig;

function textOf(ad: Ad): string {
  return ` ${[ad.headline, ad.body].filter(Boolean).join(" . ").toLowerCase()} `;
}

function snippet(ad: Ad): string {
  const t = (ad.headline ?? ad.body ?? "").replace(/\s+/g, " ").trim();
  return t.length > 110 ? `${t.slice(0, 107)}...` : t;
}

function tally(entries: { label: string; example?: string }[]): Count[] {
  const map = new Map<string, Count>();
  for (const e of entries) {
    const cur = map.get(e.label);
    if (cur) cur.count++;
    else map.set(e.label, { label: e.label, count: 1, example: e.example });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Which angles an ad uses. Every keyword hit counts the angle once for that ad. */
export function anglesOf(ad: Ad, config: AngleConfig = DEFAULT_CONFIG): string[] {
  const text = textOf(ad);
  return Object.entries(config.angles)
    .filter(([, words]) => words.some((w) => text.includes(w.toLowerCase())))
    .map(([name]) => name);
}

/** Which offers an ad makes, by regular expression. */
export function offersOf(ad: Ad, config: AngleConfig = DEFAULT_CONFIG): string[] {
  const text = textOf(ad);
  return config.offers.filter((o) => new RegExp(o.pattern, "i").test(text)).map((o) => o.label);
}

function host(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Summary of one competitor's ads: counts, running time, angles, offers, CTAs and landing pages. No model involved. */
export function summarize(competitor: Competitor, ads: Ad[], opts: { config?: AngleConfig; today?: string } = {}): CompetitorSummary {
  const config = opts.config ?? DEFAULT_CONFIG;
  const mine = ads.filter((a) => a.competitorId === competitor.id);
  const byPlatform: Partial<Record<Platform, number>> = {};
  const byFormat: Partial<Record<AdFormat, number>> = {};
  for (const a of mine) {
    byPlatform[a.platform] = (byPlatform[a.platform] ?? 0) + 1;
    byFormat[a.format] = (byFormat[a.format] ?? 0) + 1;
  }
  const withDays = mine.filter((a) => typeof a.runningDays === "number");
  const longest = [...withDays].sort((a, b) => (b.runningDays ?? 0) - (a.runningDays ?? 0)).slice(0, 3);
  const newest = [...mine].filter((a) => a.firstSeen).sort((a, b) => (b.firstSeen ?? "").localeCompare(a.firstSeen ?? "")).slice(0, 3);
  return {
    competitorId: competitor.id,
    adCount: mine.length,
    activeCount: mine.filter((a) => a.status === "active").length,
    byPlatform,
    byFormat,
    medianRunningDays: median(withDays.map((a) => a.runningDays as number)),
    longestRunning: longest.map((a) => ({ adId: a.id, days: a.runningDays as number, headline: a.headline })),
    newestAdIds: newest.map((a) => a.id),
    angles: tally(mine.flatMap((a) => anglesOf(a, config).map((label) => ({ label, example: snippet(a) })))),
    offers: tally(mine.flatMap((a) => offersOf(a, config).map((label) => ({ label, example: snippet(a) })))),
    ctas: tally(mine.filter((a) => a.cta).map((a) => ({ label: a.cta as string }))).slice(0, 5),
    landingPages: tally(mine.filter((a) => a.landingUrl).map((a) => ({ label: host(a.landingUrl as string) }))).slice(0, 5),
  };
}
