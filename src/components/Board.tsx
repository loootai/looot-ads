"use client";

import { useMemo, useState } from "react";
import { AdCard } from "./AdCard";
import { SummaryPanel } from "./SummaryPanel";
import type { AdFormat, Platform, Report } from "@/lib/types";

const PLATFORMS: Platform[] = ["meta", "google", "linkedin", "tiktok"];
const FORMATS: AdFormat[] = ["image", "video", "carousel", "text", "unknown"];

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`rounded-control border px-2.5 py-1 text-12 ${on ? "border-brand bg-brand text-brand-ink" : "border-line bg-panel text-mute hover:text-ink"}`}>
      {children}
    </button>
  );
}

/** The board: competitor filter, platform and format filters, sort, the summary for the selected competitor and the ad grid. */
export function Board({ report, initialCompetitor = "all" }: { report: Report; initialCompetitor?: string }) {
  const [competitor, setCompetitor] = useState<string>(report.competitors.some((c) => c.id === initialCompetitor) ? initialCompetitor : "all");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [format, setFormat] = useState<AdFormat | "all">("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [sort, setSort] = useState<"running" | "newest">("running");

  const names = useMemo(() => new Map(report.competitors.map((c) => [c.id, c.name])), [report.competitors]);
  const ads = useMemo(() => {
    const list = report.ads.filter((a) => (competitor === "all" || a.competitorId === competitor) && (platform === "all" || a.platform === platform) && (format === "all" || a.format === format) && (!activeOnly || a.status === "active"));
    return [...list].sort((a, b) => (sort === "running" ? (b.runningDays ?? -1) - (a.runningDays ?? -1) : (b.firstSeen ?? "").localeCompare(a.firstSeen ?? "")));
  }, [report.ads, competitor, platform, format, activeOnly, sort]);

  const selected = report.competitors.find((c) => c.id === competitor);
  const summary = report.summaries.find((s) => s.competitorId === competitor);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill on={competitor === "all"} onClick={() => setCompetitor("all")}>All competitors</Pill>
        {report.competitors.map((c) => (
          <Pill key={c.id} on={competitor === c.id} onClick={() => setCompetitor(c.id)}>
            {c.name}
          </Pill>
        ))}
      </div>

      {selected && summary ? (
        <SummaryPanel competitor={selected} summary={summary} />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {report.summaries.map((s) => (
            <button key={s.competitorId} type="button" onClick={() => setCompetitor(s.competitorId)} className="rounded-panel border border-line bg-panel p-4 text-left hover:border-line-strong">
              <div className="text-14 font-semibold">{names.get(s.competitorId)}</div>
              <div className="mt-1 text-13 text-mute">
                <span className="num">{s.adCount}</span> ads, <span className="num">{s.activeCount}</span> active
              </div>
              <div className="mt-2 text-12 text-faint">Top angle: {s.angles[0]?.label ?? "none matched"}</div>
              <div className="text-12 text-faint">Top offer: {s.offers[0]?.label ?? "none found"}</div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Pill on={platform === "all"} onClick={() => setPlatform("all")}>Every platform</Pill>
        {PLATFORMS.map((p) => (
          <Pill key={p} on={platform === p} onClick={() => setPlatform(p)}>
            {p}
          </Pill>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <Pill on={format === "all"} onClick={() => setFormat("all")}>Any format</Pill>
        {FORMATS.filter((f) => report.ads.some((a) => a.format === f)).map((f) => (
          <Pill key={f} on={format === f} onClick={() => setFormat(f)}>
            {f}
          </Pill>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <Pill on={activeOnly} onClick={() => setActiveOnly(!activeOnly)}>Active only</Pill>
        <label className="ml-auto flex items-center gap-2 text-12 text-mute">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as "running" | "newest")} className="rounded-control border border-line bg-panel px-2 py-1 text-12 text-ink">
            <option value="running">Longest running</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </div>

      <p className="text-12 text-faint">
        <span className="num">{ads.length}</span> of <span className="num">{report.ads.length}</span> ads. Thumbnails are links to the provider&apos;s files and are not stored here.
      </p>

      {ads.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line-strong p-8 text-center text-13 text-mute">No ad matches these filters.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ads.map((a) => (
            <AdCard key={`${a.platform}-${a.id}`} ad={a} competitor={names.get(a.competitorId) ?? a.competitorId} />
          ))}
        </div>
      )}
    </div>
  );
}
