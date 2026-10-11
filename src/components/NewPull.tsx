"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { usdPrecise } from "@/lib/money";
import { adminFetch } from "./adminFetch";
import type { Plan } from "@/lib/runner";
import type { Competitor, Platform } from "@/lib/types";

const ALL: Platform[] = ["meta", "google", "linkedin", "tiktok"];

interface Quote {
  plan: Plan;
  /** Signed by the server with the price. /api/run needs it. Null in the demo. */
  quoteToken: string | null;
  competitors: Competitor[];
  priceNote: string;
  unread: string[];
}

/** Competitors in, quote out, then a run button that only works on a quote the person has seen. */
export function NewPull({ demo, hasToken, capMicros }: { demo: boolean; hasToken: boolean; capMicros: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>(ALL);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function getQuote() {
    setBusy(true);
    setMessage(null);
    const res = await adminFetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competitors: text, platforms }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setQuote(null);
      return setMessage(json.error ?? "Could not quote.");
    }
    setQuote(json);
  }

  async function run() {
    if (!quote) return;
    setBusy(true);
    setMessage("Running. This can take a minute per source.");
    const res = await adminFetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competitors: text, platforms, quoteToken: quote.quoteToken }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setMessage(json.error ?? "The run failed.");
    router.push("/");
  }

  const canRun = !demo && hasToken && quote !== null && quote.quoteToken !== null && quote.plan.lines.length > 0 && !busy;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-20 font-semibold">New pull</h1>
        <p className="mt-1 text-13 text-mute">One competitor per line or comma separated. A domain unlocks Google Ads and the Adyntel lookups; a bare name works for Meta, LinkedIn and TikTok.</p>
      </div>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setQuote(null); }} rows={5} placeholder={"acme.com\nGlobex\ninitech.io"} className="w-full rounded-panel border border-line bg-panel p-3 text-13 outline-none focus:border-emerald" />
      <div className="flex flex-wrap items-center gap-2">
        {ALL.map((p) => (
          <label key={p} className="flex items-center gap-1.5 rounded-control border border-line bg-panel px-2.5 py-1 text-12">
            <input type="checkbox" checked={platforms.includes(p)} onChange={() => { setQuote(null); setPlatforms(platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p]); }} />
            {p}
          </label>
        ))}
        <label className="ml-auto flex items-center gap-2 text-12 text-mute">
          Spend cap <span className="num text-ink">{usdPrecise(capMicros)}</span> (set on the server)
        </label>
      </div>
      <button type="button" onClick={getQuote} disabled={busy || !text.trim() || platforms.length === 0} className="rounded-control border border-line bg-panel px-4 py-2 text-13 font-medium hover:bg-hover disabled:opacity-50">
        Show the price
      </button>

      {quote && (
        <section className="rounded-panel border border-line bg-panel">
          <table className="w-full text-left text-13">
            <thead>
              <tr className="border-b border-line text-12 text-faint">
                <th className="p-3 font-medium">Competitor</th>
                <th className="p-3 font-medium">Platform</th>
                <th className="p-3 font-medium">Endpoint</th>
                <th className="p-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {quote.plan.lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="p-3">{quote.competitors.find((c) => c.id === l.competitorId)?.name}</td>
                  <td className="p-3">{l.platform}</td>
                  <td className="num p-3 text-12 text-mute">{l.endpointId}</td>
                  <td className="num p-3 text-right">{usdPrecise(l.priceMicros)}</td>
                </tr>
              ))}
              {quote.plan.skipped.map((s, i) => (
                <tr key={`s${i}`} className="border-b border-line text-mute last:border-0">
                  <td className="p-3">{quote.competitors.find((c) => c.id === s.competitorId)?.name}</td>
                  <td className="p-3">{s.platform}</td>
                  <td className="p-3 text-12" colSpan={2}>Skipped. {s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 border-t border-line p-3">
            <p className="text-13">
              <span className="num font-semibold">{usdPrecise(quote.plan.totalMicros)}</span> total at {quote.priceNote}. Cap <span className="num">{usdPrecise(quote.plan.capMicros)}</span>.
            </p>
            <button type="button" onClick={run} disabled={!canRun} className="ml-auto rounded-control bg-brand px-4 py-2 text-13 font-medium text-brand-ink disabled:opacity-40">
              Run for {usdPrecise(quote.plan.totalMicros)}
            </button>
          </div>
          {!quote.plan.withinCap && <p className="border-t border-line p-3 text-12 text-amber">The plan costs more than the cap. Calls run in order and stop at the cap.</p>}
          {quote.unread.length > 0 && <p className="border-t border-line p-3 text-12 text-amber">Live price not readable for {quote.unread.join(", ")}. Those calls will not run.</p>}
        </section>
      )}
      {demo && <p className="text-12 text-mute">Demo mode shows the quote but never runs. Set LOOOT_TOKEN and start with <code className="num">npm run dev</code> to run.</p>}
      {!demo && !hasToken && <p className="text-12 text-mute">LOOOT_TOKEN is not set on the server, so the run button stays off.</p>}
      {message && <p role="status" className="text-13 text-mute">{message}</p>}
    </div>
  );
}
