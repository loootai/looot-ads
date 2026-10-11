import { createHash } from "node:crypto";
import { summarize } from "./analyze";
import { LoootError, TERMINAL_STATUSES, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { parseAds } from "./normalize";
import { today as clockToday } from "./clock";
import { SOURCE_DEFS, defaultPlatforms, isPlanned, planCall, type PlannedCall, type SkippedCall, type SourceDef } from "./sources";
import { SpendGuard, type PriceMap } from "./spend";
import type { Ad, Competitor, Platform, Report, SourceRun } from "./types";

export interface PlanLine extends PlannedCall {
  priceMicros: number;
}

export interface Plan {
  lines: PlanLine[];
  skipped: SkippedCall[];
  totalMicros: number;
  capMicros: number;
  /** true when the whole plan fits under the cap. A plan over the cap still runs, in order, until the cap stops it. */
  withinCap: boolean;
}

/**
 * Works out which calls a run makes and what they cost at the given prices. Makes no call.
 * With no platforms given, each row uses its own defaults (named competitors: the original four, keywords: the five keyword platforms).
 */
export function buildPlan(competitors: Competitor[], platforms: Platform[] | undefined, prices: PriceMap, capMicros: number, defs: SourceDef[] = SOURCE_DEFS, today: string = clockToday()): Plan {
  const lines: PlanLine[] = [];
  const skipped: SkippedCall[] = [];
  for (const c of competitors) {
    for (const p of platforms ?? defaultPlatforms(c)) {
      const call = planCall(c, p, defs, today);
      if (isPlanned(call)) lines.push({ ...call, priceMicros: prices[call.endpointId] ?? 0 });
      else skipped.push(call);
    }
  }
  const totalMicros = lines.reduce((n, l) => n + l.priceMicros, 0);
  return { lines, skipped, totalMicros, capMicros, withinCap: totalMicros <= capMicros };
}

/** Stable key for one (job, input). The same input replays the stored run and is never charged twice. `tag` starts a fresh pull. */
export function idempotencyKey(endpointId: string, input: Record<string, unknown>, tag = ""): string {
  const hash = createHash("sha256").update(JSON.stringify([endpointId, sortKeys(input), tag])).digest("hex").slice(0, 24);
  return `looot-ads:${endpointId}:${hash}`;
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

export interface RunOptions {
  competitors: Competitor[];
  plan: Plan;
  looot: LoootRunner;
  /** Endpoints whose live price could not be read. They are not called. */
  unpriced?: string[];
  today: string;
  freshTag?: string;
  onProgress?: (run: SourceRun) => void;
}

/**
 * Makes the planned calls one after another and builds the report.
 * Before each call the guard checks the cap. A refused call costs nothing.
 * A run still going when the wait ends is "pending" and counts at its quoted price until it settles.
 * A failed run costs nothing.
 */
export async function runPlan(opts: RunOptions): Promise<Report> {
  const guard = new SpendGuard(opts.plan.capMicros);
  const ads: Ad[] = [];
  const runs: SourceRun[] = [];
  const unpriced = new Set(opts.unpriced ?? []);

  for (const s of opts.plan.skipped) {
    runs.push({ competitorId: s.competitorId, platform: s.platform, jobId: "", endpointId: "", state: "skipped", costMicros: 0, adCount: 0, message: s.reason });
  }

  for (const line of opts.plan.lines) {
    const base = { competitorId: line.competitorId, platform: line.platform, jobId: line.jobId, endpointId: line.endpointId };
    let run: SourceRun;
    if (unpriced.has(line.endpointId)) {
      run = { ...base, state: "blocked", costMicros: 0, adCount: 0, message: "The live price could not be read, so the call was not made." };
    } else if (!guard.canAfford(line.priceMicros)) {
      run = { ...base, state: "blocked", costMicros: 0, adCount: 0, message: `Spend cap reached (${guard.describe()}). This call would cost more than the cap allows.` };
    } else {
      run = await callOne(opts, line, guard, base, ads);
    }
    runs.push(run);
    opts.onProgress?.(run);
  }

  return buildReport({ competitors: opts.competitors, ads, runs, spendMicros: guard.spentMicros, capMicros: opts.plan.capMicros, mode: "live", now: new Date(`${opts.today}T12:00:00Z`) });
}

async function callOne(opts: RunOptions, line: PlanLine, guard: SpendGuard, base: Pick<SourceRun, "competitorId" | "platform" | "jobId" | "endpointId">, ads: Ad[]): Promise<SourceRun> {
  try {
    const res = await opts.looot.runAndWait(line.endpointId, line.input, idempotencyKey(line.endpointId, line.input, opts.freshTag));
    if (!TERMINAL_STATUSES.has(res.status)) {
      guard.record(line.priceMicros);
      return { ...base, state: "pending", runId: res.runId, costMicros: line.priceMicros, adCount: 0, message: `Still ${res.status} when waiting stopped. Not failed. Run the same command again to read it; the stored run is replayed and not charged twice.` };
    }
    if (res.status !== "completed") {
      return { ...base, state: "failed", runId: res.runId, costMicros: 0, adCount: 0, message: res.error?.message ?? `The run ended as ${res.status}. Nothing was charged.` };
    }
    const cost = res.actualCost === null || res.actualCost === undefined ? line.priceMicros : toMicros(res.actualCost);
    guard.record(cost);
    const found = parseAds(res.result, { competitorId: line.competitorId, platform: line.platform, jobId: line.jobId, today: opts.today });
    ads.push(...found);
    return { ...base, state: "completed", runId: res.runId, costMicros: cost, adCount: found.length, message: found.length === 0 ? "The library returned no ads for this input." : undefined };
  } catch (e) {
    const msg = e instanceof LoootError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : (e as Error).message;
    return { ...base, state: "failed", costMicros: 0, adCount: 0, message: msg };
  }
}

/** Sorts the ads (active first, longest running first) and adds the per-competitor summaries. */
export function buildReport(input: { competitors: Competitor[]; ads: Ad[]; runs: SourceRun[]; spendMicros: number; capMicros: number; mode: Report["mode"]; now: Date }): Report {
  const today = input.now.toISOString().slice(0, 10);
  const ads = [...input.ads].sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || (b.runningDays ?? -1) - (a.runningDays ?? -1));
  return {
    version: 1,
    createdAt: input.now.toISOString(),
    mode: input.mode,
    competitors: input.competitors,
    ads,
    runs: input.runs,
    spendMicros: input.spendMicros,
    capMicros: input.capMicros,
    summaries: input.competitors.map((c) => summarize(c, ads, { today })),
  };
}
