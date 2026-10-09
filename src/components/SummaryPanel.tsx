import type { Competitor, CompetitorSummary, Count } from "@/lib/types";

function Chips({ title, items, empty }: { title: string; items: Count[]; empty: string }) {
  return (
    <div>
      <h4 className="mb-1.5 text-12 font-medium uppercase tracking-wide text-faint">{title}</h4>
      {items.length === 0 ? (
        <p className="text-13 text-mute">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 5).map((i) => (
            <li key={i.label} className="text-13">
              <span className="font-medium">{i.label}</span> <span className="num text-mute">{i.count}</span>
              {i.example && <p className="truncate text-12 text-faint" title={i.example}>&ldquo;{i.example}&rdquo;</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Angles, offers, CTAs and landing pages for one competitor. Counts come from keyword rules in config/angles.json. */
export function SummaryPanel({ competitor, summary }: { competitor: Competitor; summary: CompetitorSummary }) {
  return (
    <section className="rounded-panel border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-16 font-semibold">{competitor.name}</h2>
        <p className="text-13 text-mute">
          <span className="num">{summary.adCount}</span> ads, <span className="num">{summary.activeCount}</span> active, median running time <span className="num">{summary.medianRunningDays ?? "unknown"}</span> days
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Chips title="Angles" items={summary.angles} empty="No angle keywords matched." />
        <Chips title="Offers" items={summary.offers} empty="No offer found in the copy." />
        <Chips title="Calls to action" items={summary.ctas} empty="No call to action returned." />
        <Chips title="Landing pages" items={summary.landingPages} empty="No landing page returned." />
      </div>
    </section>
  );
}
