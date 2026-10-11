import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS, budgetFieldError } from "./budget";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { FALLBACK_PRICES } from "./prices";
import { buildPlan, runPlan } from "./runner";
import { SOURCE_DEFS, isPlanned, planCall } from "./sources";

const now = new Date("2026-10-10T09:00:00Z");
const TODAY = "2026-10-10";
const acme = { id: "acme-com", name: "Acme", domain: "acme.com" };
const globex = { id: "globex", name: "Globex", domain: "globex.com" };
const initech = { id: "initech", name: "Initech", domain: "initech.com" };
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number, endpointId: string) => LoootRun | Promise<LoootRun>) {
  const calls: { endpointId: string; key: string }[] = [];
  const looot: LoootRunner = {
    async runAndWait(endpointId, _input, key) {
      calls.push({ endpointId, key });
      return answer(calls.length, endpointId);
    },
  };
  return { looot, calls };
}
const completed = (cost: number): LoootRun => ({ runId: "run_ok", status: "completed", result: { ads: [] }, actualCost: cost });
const planFor = (comps: (typeof acme)[], platforms: ("meta" | "google" | "linkedin")[] = ["meta"], cap = 5_000_000) => buildPlan(comps, platforms, FALLBACK_PRICES, cap, SOURCE_DEFS, TODAY);
const run = (comps: (typeof acme)[], looot: LoootRunner, ledger: Budget, extra: { platforms?: ("meta" | "google" | "linkedin")[]; freshTag?: string } = {}) =>
  runPlan({ competitors: comps, plan: planFor(comps, extra.platforms), looot, today: TODAY, now, ledger, freshTag: extra.freshTag });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const s2 = await b.status(new Date("2026-10-11T09:00:00Z"));
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });

  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost and stores the answer", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("runPlan with the budget", () => {
  it("does not charge a repeated identical request twice", async () => {
    const b = open();
    const first = runner(() => completed(0.00188));
    const r1 = await run([acme], first.looot, b);
    const second = runner(() => completed(0.00188));
    const r2 = await run([acme], second.looot, b);
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    expect(r2.spendMicros).toBe(0);
    expect(r2.runs[0].state).toBe("completed");
    expect((await b.status(now)).day.usedMicros).toBe(r1.spendMicros);
  });

  it("answers two identical requests started together with one charge", async () => {
    const slow = () => runner(async () => { await new Promise((r) => setTimeout(r, 20)); return completed(0.00188); });
    const [a, c] = [slow(), slow()];
    await Promise.all([run([acme], a.looot, open()), run([acme], c.looot, open())]);
    const s = await open().status(now);
    expect(s.day.usedMicros).toBe(1_880);
    expect(s.day.reservedMicros).toBe(0);
  });

  it("charges again only for an explicit fresh pull, which has its own stable key", async () => {
    const b = open();
    const a = runner(() => completed(0.00188));
    await run([acme], a.looot, b);
    const c = runner(() => completed(0.00188));
    await run([acme], c.looot, b, { freshTag: "oct" });
    const d = runner(() => completed(0.00188));
    await run([acme], d.looot, b, { freshTag: "oct" });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].key).not.toBe(a.calls[0].key);
    expect(d.calls).toHaveLength(0);
  });

  it("holds total charges inside the budget when requests run at the same time", async () => {
    await open().setLimits({ dailyMicros: 6_000, monthlyMicros: 6_000 });
    const comps = [acme, globex, initech, { id: "umbrella", name: "Umbrella", domain: "umbrella.com" }, { id: "wayne", name: "Wayne", domain: "wayne.com" }];
    const sources = comps.map(() => runner(async () => { await new Promise((r) => setTimeout(r, 10)); return completed(0.00188); }));
    const reports = await Promise.all(comps.map((c, i) => run([c], sources[i].looot, open())));
    const paid = sources.reduce((n, s) => n + s.calls.length, 0);
    const s = await open().status(now);
    expect(paid).toBe(3);
    expect(s.day.usedMicros).toBe(3 * 1_880);
    expect(s.day.usedMicros + s.day.reservedMicros).toBeLessThanOrEqual(6_000);
    expect(reports.filter((r) => r.runs[0].state === "blocked")).toHaveLength(2);
  });

  it("stops many small runs one after another at the budget", async () => {
    await open().setLimits({ dailyMicros: 5_000, monthlyMicros: 5_000 });
    const b = open();
    const seen = runner(() => completed(0.00188));
    for (let i = 0; i < 8; i++) await run([{ id: `c${i}`, name: `Brand ${i}`, domain: `b${i}.com` }], seen.looot, b);
    expect(seen.calls).toHaveLength(2);
    expect((await b.status(now)).day.usedMicros).toBe(3_760);
  });

  it("refuses a call over the budget, says so, and makes no call", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000, monthlyMicros: 1_000 });
    const { looot, calls } = runner(() => completed(0.00188));
    const report = await run([acme], looot, b);
    expect(calls).toHaveLength(0);
    expect(report.runs[0].state).toBe("blocked");
    expect(report.runs[0].message).toMatch(/budget is reached/i);
  });

  it("keeps the reservation of a pending call and never records it as $0", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const report = await run([acme], looot, b);
    expect(report.runs[0].state).toBe("pending");
    expect(report.runs[0].costMicros).toBe(1_880);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(1_880);
    expect(s.day.usedMicros).toBe(0);
  });

  it("settles a pending call to its real cost when it finishes later", async () => {
    const b = open();
    await run([acme], runner(() => ({ runId: "run_slow", status: "running" })).looot, b);
    await b.reconcile({ getRun: async () => ({ runId: "run_slow", status: "completed", result: { ads: [] }, actualCost: 0.0017 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(1_700);
    const again = runner(() => completed(0.00188));
    await run([acme], again.looot, b);
    expect(again.calls).toHaveLength(0);
  });

  it("releases the reservation of a call that looot refused with an HTTP answer", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const report = await run([acme], looot, b);
    expect(report.runs[0].state).toBe("failed");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await run([acme], looot, b);
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await run([acme], looot, b);
    expect((await b.status(now)).day.reservedMicros).toBe(1_880);
  });
});

describe("stable keys", () => {
  const withHandle = { id: "contoso", name: "Contoso", handle: "contoso_example" };
  const keyOf = (today: string) => {
    const c = planCall(withHandle, "x", SOURCE_DEFS, today);
    if (!isPlanned(c)) throw new Error("not planned");
    return c.input;
  };
  it("sends the same X input on every day of one period, so the key does not change by the day", () => {
    expect(keyOf("2026-10-08")).toEqual(keyOf("2026-10-10"));
  });
  it("starts a new request in the next period", () => {
    expect(keyOf("2026-10-10")).not.toEqual(keyOf("2026-10-30"));
  });
});

describe("budget fields in a request", () => {
  it("names a request that tries to carry a budget", () => {
    expect(budgetFieldError({ dailyUsd: 1000 })).toMatch(/cannot set the budget/);
    expect(budgetFieldError({ competitors: "acme.com" })).toBeNull();
  });
});
