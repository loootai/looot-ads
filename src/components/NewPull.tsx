"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { usdPrecise } from "@/lib/money";
import { adminFetch } from "./adminFetch";
import type { Plan } from "@/lib/runner";
import { PLATFORM_LABEL, type Competitor, type Platform } from "@/lib/types";

type Mode = "competitors" | "keywords";

/** Platforms offered per mode, and the ones ticked at first. Keyword mode needs no competitor name. */
const MODE_PLATFORMS: Record<Mode, { all: Platform[]; on: Platform[] }> = {
  competitors: { all: ["meta", "google", "linkedin", "tiktok", "x"], on: ["meta", "google", "linkedin", "tiktok"] },
  keywords: { all: ["meta", "linkedin", "tiktok", "reddit", "tiktoktop"], on: ["meta", "linkedin", "tiktok", "reddit", "tiktoktop"] },
};

/** Keyword mode sends each topic as a "kw:" line, so the server tells it from a competitor. */
function toPullText(mode: Mode, text: string): string {
  if (mode === "competitors") return text;
  return text.split(/[\n,]/).map((k) => k.trim()).filter(Boolean).map((k) => `kw: ${k}`).join("\n");
}

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
  const [mode, setMode] = useState<Mode>("competitors");
  const [platforms, setPlatforms] = useState<Platform[]>(MODE_PLATFORMS.competitors.on);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function getQuote() {
    setBusy(true);
    setMessage(null);
    const res = await adminFetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competitors: toPullText(mode, text), platforms }) });
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
    const res = await adminFetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ competitors: toPullText(mode, text), platforms, quoteToken: quote.quoteToken }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setMessage(json.error ?? "The run failed.");
    router.push("/");
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPlatforms(MODE_PLATFORMS[next].on);
    setQuote(null);
    setMessage(null);
  }

  const canRun = !demo && hasToken && quote !== null && quote.quoteToken !== null && quote.plan.lines.length > 0 && !busy;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-20 font-semibold">New pull</h1>
        <p className="mt-1 text-13 text-mute">
          {mode === "competitors"
            ? "One competitor per line or comma separated. Google Ads needs a domain; Meta, LinkedIn and TikTok search by name. Add @handle after a name to include X."
            : "One topic per line or comma separated. Finds ads from brands you did not name, on Meta, LinkedIn, TikTok, Reddit and TikTok top ads. Google and X have no keyword search."}
        </p>
      </div>
      <div role="group" aria-label="What to look up" className="flex gap-2">
        {(["competitors", "keywords"] as Mode[]).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)} className={`rounded-control border px-3 py-1 text-13 ${mode === m ? "border-brand bg-brand text-brand-ink" : "border-line bg-panel text-mute hover:text-ink"}`}>
            {m === "competitors" ? "Named competitors" : "Discover by keyword"}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setQuote(null); }} rows={5} placeholder={mode === "competitors" ? "acme.com\nGlobex\ninitech.io @initech" : "crm software\ninvoice automation"} className="w-full rounded-panel border border-line bg-panel p-3 text-13 outline-none focus:border-emerald" />
      <div className="flex flex-wrap items-center gap-2">
        {MODE_PLATFORMS[mode].all.map((p) => (
          <label key={p} className="flex items-center gap-1.5 rounded-control border border-line bg-panel px-2.5 py-1 text-12">
            <input type="checkbox" checked={platforms.includes(p)} onChange={() => { setQuote(null); setPlatforms(platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p]); }} />
            {PLATFORM_LABEL[p]}
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
                <th className="p-3 font-medium">{mode === "competitors" ? "Competitor" : "Keyword"}</th>
                <th className="p-3 font-medium">Platform</th>
                <th className="p-3 font-medium">Provider</th>
                <th className="p-3 font-medium">Endpoint</th>
                <th className="p-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {quote.plan.lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="p-3">{quote.competitors.find((c) => c.id === l.competitorId)?.name}</td>
                  <td className="p-3">{PLATFORM_LABEL[l.platform]}</td>
                  <td className="p-3 text-12">{l.provider}</td>
                  <td className="num p-3 text-12 text-mute">{l.endpointId}{l.resultCount ? ` (up to ${l.resultCount} results)` : ""}</td>
                  <td className="num p-3 text-right">{usdPrecise(l.priceMicros)}</td>
                </tr>
              ))}
              {quote.plan.skipped.map((s, i) => (
                <tr key={`s${i}`} className="border-b border-line text-mute last:border-0">
                  <td className="p-3">{quote.competitors.find((c) => c.id === s.competitorId)?.name}</td>
                  <td className="p-3">{PLATFORM_LABEL[s.platform]}</td>
                  <td className="p-3 text-12" colSpan={3}>Skipped. {s.reason}</td>
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
