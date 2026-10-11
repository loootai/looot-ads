import { createHash } from "node:crypto";
import { summarize } from "./analyze";
import type { Ledger } from "./budget";
import { LoootError, TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
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

/** Hash of what a paid call asks for: endpoint and input, with sorted keys and lowercased text. Guards the short key against a collision. */
export function callFingerprint(endpointId: string, input: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => (typeof v === "string" ? v.trim().toLowerCase() : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, norm(x)])) : v);
  return createHash("sha256").update(JSON.stringify([endpointId, norm(input)])).digest("hex");
}

/** Stable key for one (job, input). No date or time goes in. The same input replays the stored run and is never charged twice. `tag` starts a fresh pull, with its own stable key. */
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
  /** Period budget, reservations and stored answers. Left out in tests that do not need it. */
  ledger?: Ledger;
  /** The clock for the ledger. Defaults to now. */
  now?: Date;
  onProgress?: (run: SourceRun) => void;
}

/**
 * Makes the planned calls one after another and builds the report.
 * Check order for each call: the quote, the per-run cap, a stored answer, the period budget (an atomic reservation), then the call.
 * A refused call costs nothing. A finished call is stored, so the same request is answered later with no call.
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

/** A ledger write that fails (a locked file) must not hide a call that already ran. The reservation then stays until the next reconcile or the hard expiry. */
async function quiet(fn: () => Promise<void> | undefined): Promise<void> {
  try {
    await fn();
  } catch {
    // The call result is already in hand; the reservation stays held, which errs on the side of spending less.
  }
}

async function callOne(opts: RunOptions, line: PlanLine, guard: SpendGuard, base: Pick<SourceRun, "competitorId" | "platform" | "jobId" | "endpointId">, ads: Ad[]): Promise<SourceRun> {
  const key = idempotencyKey(line.endpointId, line.input, opts.freshTag);
  const ledger = opts.ledger;
  const now = opts.now ?? new Date();
  const fp = callFingerprint(line.endpointId, line.input);
  const done = (res: LoootRun, cost: number, note?: string): SourceRun => {
    const found = parseAds(res.result, { competitorId: line.competitorId, platform: line.platform, jobId: line.jobId, today: opts.today });
    ads.push(...found);
    return { ...base, state: "completed", runId: res.runId, costMicros: cost, adCount: found.length, message: note ?? (found.length === 0 ? "The library returned no ads for this input." : undefined) };
  };
  if (ledger) {
    const stored = await ledger.recall(key, fp, now);
    if (stored) return done(stored, 0, "Answered from the stored result. No call, no charge.");
    const held = await ledger.reserve(key, line.priceMicros, now, fp);
    if (!held.ok) return { ...base, state: "blocked", costMicros: 0, adCount: 0, message: held.message };
  }
  try {
    const res = await opts.looot.runAndWait(line.endpointId, line.input, key);
    if (!TERMINAL_STATUSES.has(res.status)) {
      // Still running at looot: the reservation stays until the run ends. It is never recorded as failed at zero.
      guard.record(line.priceMicros);
      await quiet(() => ledger?.attach(key, res.runId));
      return { ...base, state: "pending", runId: res.runId, costMicros: line.priceMicros, adCount: 0, message: `Still ${res.status} when waiting stopped. Not failed. Run the same command again to read it; the stored run is replayed and not charged twice.` };
    }
    if (res.status !== "completed") {
      await quiet(() => ledger?.settle(key, fp, toMicros(res.actualCost), now));
      return { ...base, state: "failed", runId: res.runId, costMicros: 0, adCount: 0, message: res.error?.message ?? `The run ended as ${res.status}. Nothing was charged.` };
    }
    const cost = res.actualCost === null || res.actualCost === undefined ? line.priceMicros : toMicros(res.actualCost);
    guard.record(cost);
    await quiet(() => ledger?.settle(key, fp, cost, now, res));
    return done(res, cost);
  } catch (e) {
    // An HTTP answer from looot means the call did not run, so the reservation goes back. A network error is unknown:
    // the request may have been accepted, so the reservation stays until the hard expiry or a replay settles it.
    if (e instanceof LoootError) await ledger?.release(key);
    const msg = e instanceof LoootError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : (e as Error).message;
    return { ...base, state: "failed", costMicros: 0, adCount: 0, message: msg };
  }
}

/**
 * What the plan can still charge: the list price of every call that has no stored answer in the ledger.
 * A repeat of a finished pull costs 0 here, so the up-front budget check does not refuse a request that would be answered with no call.
 */
export async function chargeableMicros(plan: Plan, ledger: Ledger, opts: { freshTag?: string; now?: Date } = {}): Promise<number> {
  let total = 0;
  for (const line of plan.lines) {
    const stored = await ledger.recall(idempotencyKey(line.endpointId, line.input, opts.freshTag), callFingerprint(line.endpointId, line.input), opts.now ?? new Date());
    if (!stored) total += line.priceMicros;
  }
  return total;
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
