import Link from "next/link";
import { Board } from "@/components/Board";
import { requireAdminPage } from "@/lib/auth/guard";
import { usd } from "@/lib/money";
import { loadReport } from "@/lib/store";
import { PLATFORM_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAdminPage();
  const { c } = await searchParams;
  const report = loadReport();
  if (!report) {
    return (
      <div className="mx-auto max-w-xl rounded-panel border border-line bg-panel p-8 text-center">
        <h1 className="text-16 font-semibold">No pull yet</h1>
        <p className="mt-2 text-13 text-mute">Name a few competitors, see the price, then run. Or start with <code className="num">npm run demo</code> to look around with invented brands.</p>
        <Link href="/new" className="mt-4 inline-block rounded-control bg-brand px-4 py-2 text-13 font-medium text-brand-ink">New pull</Link>
      </div>
    );
  }
  const pending = report.runs.filter((r) => r.state === "pending").length;
  const failed = report.runs.filter((r) => r.state === "failed" || r.state === "blocked");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-20 font-semibold">Competitor ads</h1>
        <p className="text-13 text-mute">
          Pulled <span className="num">{report.createdAt.slice(0, 10)}</span>, <span className="num">{report.ads.length}</span> ads, spent <span className="num">{usd(report.spendMicros)}</span> of a <span className="num">{usd(report.capMicros)}</span> cap
        </p>
      </div>
      {(pending > 0 || failed.length > 0) && (
        <div className="rounded-panel border border-line bg-amber-soft p-3 text-13 text-amber">
          {pending > 0 && <p>{pending} source(s) still pending. They are not failed; pull again with the same names to read them, you are not charged twice.</p>}
          {failed.map((r, i) => (
            <p key={i}>
              {r.competitorId} on {PLATFORM_LABEL[r.platform]}: {r.state}. {r.message}
            </p>
          ))}
        </div>
      )}
      <Board report={report} initialCompetitor={c} />
    </div>
  );
}
