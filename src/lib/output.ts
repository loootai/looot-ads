import { usd, usdPrecise } from "./money";
import { PLATFORM_LABEL, type Ad, type Competitor, type Report } from "./types";
import type { Plan } from "./runner";

function cell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per ad. Links only; no creative file is embedded. */
export function adsToCsv(report: Report): string {
  const names = new Map(report.competitors.map((c) => [c.id, c.name]));
  const head = ["competitor", "platform", "advertiser", "ad_id", "status", "format", "first_seen", "last_seen", "running_days", "headline", "body", "cta", "landing_url", "thumbnail_url", "library_url"];
  const rows = report.ads.map((a: Ad) => [names.get(a.competitorId) ?? a.competitorId, a.platform, a.advertiser, a.id, a.status, a.format, a.firstSeen, a.lastSeen, a.runningDays, a.headline, a.body, a.cta, a.landingUrl, a.thumbnailUrl, a.libraryUrl].map(cell).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}

/** The plan as text: each call, its list price, the total and the cap. */
export function renderPlan(plan: Plan, competitors: Competitor[], priceNote: string): string {
  const names = new Map(competitors.map((c) => [c.id, c.name]));
  const out = ["Plan", ""];
  for (const l of plan.lines) out.push(`  ${(names.get(l.competitorId) ?? l.competitorId).padEnd(22)} ${PLATFORM_LABEL[l.platform].padEnd(14)} ${l.endpointId.padEnd(52)} ${usdPrecise(l.priceMicros)}`);
  for (const s of plan.skipped) out.push(`  ${(names.get(s.competitorId) ?? s.competitorId).padEnd(22)} ${PLATFORM_LABEL[s.platform].padEnd(14)} skipped: ${s.reason}`);
  out.push("", `  ${plan.lines.length} calls, ${usdPrecise(plan.totalMicros)} at ${priceNote}. Spend cap ${usdPrecise(plan.capMicros)}.`);
  if (!plan.withinCap) out.push(`  The plan is over the cap. Calls run in order until the cap stops them.`);
  return out.join("\n");
}

/** Markdown brief: one section per competitor with the summary, then what each source returned. */
export function reportToMarkdown(report: Report): string {
  const names = new Map(report.competitors.map((c) => [c.id, c.name]));
  const L: string[] = [`# Competitor ads`, "", `Pulled ${report.createdAt.slice(0, 10)}. ${report.ads.length} ads from ${report.competitors.length} competitors. Spent ${usd(report.spendMicros)} of a ${usd(report.capMicros)} cap.`, ""];
  for (const s of report.summaries) {
    const c = report.competitors.find((x) => x.id === s.competitorId);
    L.push(`## ${c?.name ?? s.competitorId}`, "");
    if (s.adCount === 0) { L.push("No ads came back.", ""); continue; }
    L.push(`${s.adCount} ads, ${s.activeCount} active. Median running time ${s.medianRunningDays ?? "unknown"} days. Platforms: ${Object.entries(s.byPlatform).map(([p, n]) => `${p} ${n}`).join(", ")}.`, "");
    if (s.angles.length) L.push("Angles", "", ...s.angles.map((a) => `- ${a.label}, ${a.count} ads. Example: "${a.example}"`), "");
    if (s.offers.length) L.push("Offers", "", ...s.offers.map((a) => `- ${a.label}, ${a.count} ads. Example: "${a.example}"`), "");
    if (s.longestRunning.length) L.push("Longest running", "", ...s.longestRunning.map((a) => `- ${a.days} days: ${a.headline ?? a.adId}`), "");
    if (s.landingPages.length) L.push("Landing pages", "", ...s.landingPages.map((a) => `- ${a.label}, ${a.count} ads`), "");
  }
  L.push("## Sources", "", "| Competitor | Platform | Endpoint | State | Ads | Cost |", "| --- | --- | --- | --- | --- | --- |");
  for (const r of report.runs) L.push(`| ${names.get(r.competitorId) ?? r.competitorId} | ${r.platform} | ${r.endpointId || "none"} | ${r.state}${r.message ? `, ${r.message.replace(/\|/g, "/")}` : ""} | ${r.adCount} | ${usdPrecise(r.costMicros)} |`);
  return L.join("\n") + "\n";
}
