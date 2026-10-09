import { describe, expect, it, vi } from "vitest";
import type { LoootRun, LoootRunner } from "./looot";
import { LoootError } from "./looot";
import { buildPlan, idempotencyKey, runPlan } from "./runner";
import { FALLBACK_PRICES } from "./prices";

const acme = { id: "acme-com", name: "Acme", domain: "acme.com" };
const initech = { id: "initech", name: "Initech" };
const ok = (runId: string, ads: unknown[], actualCost?: number): LoootRun => ({ runId, status: "completed", result: { ads }, actualCost });

function mock(fn: (endpointId: string, input: Record<string, unknown>, key: string) => Promise<LoootRun>): LoootRunner & { calls: { endpointId: string; key: string }[] } {
  const calls: { endpointId: string; key: string }[] = [];
  return { calls, runAndWait: (e, i, k) => { calls.push({ endpointId: e, key: k }); return fn(e, i, k); } };
}

describe("buildPlan", () => {
  it("prices every call and skips what has no input", () => {
    const plan = buildPlan([acme, initech], ["meta", "google"], FALLBACK_PRICES, 1_000_000);
    expect(plan.lines.map((l) => l.endpointId)).toEqual(["adyntel-facebook", "adyntel-google", "scrapecreators-facebook-adlibrary-company-ads-get"]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.totalMicros).toBe(6420 + 6420 + 1880);
    expect(plan.withinCap).toBe(true);
  });
});

describe("idempotencyKey", () => {
  it("is stable for the same input and ignores key order", () => {
    expect(idempotencyKey("e", { a: 1, b: 2 })).toBe(idempotencyKey("e", { b: 2, a: 1 }));
  });
  it("changes with the endpoint, the input and the fresh tag", () => {
    const k = idempotencyKey("e", { a: 1 });
    expect(idempotencyKey("f", { a: 1 })).not.toBe(k);
    expect(idempotencyKey("e", { a: 2 })).not.toBe(k);
    expect(idempotencyKey("e", { a: 1 }, "oct")).not.toBe(k);
  });
});

describe("runPlan", () => {
  const plan = buildPlan([acme], ["meta", "linkedin"], FALLBACK_PRICES, 1_000_000);

  it("runs each call, parses ads and adds the cost", async () => {
    const looot = mock(async (e) => ok(`r-${e}`, [{ id: e, title: `Ad from ${e}`, is_active: true }], 0.00642));
    const report = await runPlan({ competitors: [acme], plan, looot, today: "2026-10-10" });
    expect(report.ads).toHaveLength(2);
    expect(report.spendMicros).toBe(12840);
    expect(report.runs.every((r) => r.state === "completed")).toBe(true);
    expect(report.summaries[0].adCount).toBe(2);
  });

  it("calls with the stable key", async () => {
    const looot = mock(async (e) => ok(e, []));
    await runPlan({ competitors: [acme], plan, looot, today: "2026-10-10" });
    expect(looot.calls[0].key).toBe(idempotencyKey("adyntel-facebook", { company_domain: "acme.com" }));
  });

  it("stops at the cap and makes no call it cannot afford", async () => {
    const small = buildPlan([acme], ["meta", "google", "linkedin"], FALLBACK_PRICES, 7000);
    const looot = mock(async (e) => ok(e, [{ id: e, title: "x" }]));
    const report = await runPlan({ competitors: [acme], plan: small, looot, today: "2026-10-10" });
    expect(looot.calls).toHaveLength(1);
    expect(report.runs.filter((r) => r.state === "blocked")).toHaveLength(2);
    expect(report.spendMicros).toBe(6420);
  });

  it("reports a run still going as pending, not failed, and counts its quoted price", async () => {
    const looot = mock(async () => ({ runId: "r1", status: "running" }));
    const report = await runPlan({ competitors: [acme], plan: buildPlan([acme], ["meta"], FALLBACK_PRICES, 1e6), looot, today: "2026-10-10" });
    expect(report.runs[0]).toMatchObject({ state: "pending", runId: "r1", costMicros: 6420 });
  });

  it("charges nothing for a failed run or a thrown error", async () => {
    const looot = mock(async (e) => {
      if (e === "adyntel-facebook") return { runId: "r2", status: "failed", error: { message: "provider down" } };
      throw new LoootError("bad token", 401, "unauthorized");
    });
    const report = await runPlan({ competitors: [acme], plan, looot, today: "2026-10-10" });
    expect(report.runs.map((r) => r.state)).toEqual(["failed", "failed"]);
    expect(report.runs[1].message).toContain("unauthorized");
    expect(report.spendMicros).toBe(0);
  });

  it("does not call an endpoint whose live price could not be read", async () => {
    const looot = mock(async (e) => ok(e, []));
    const report = await runPlan({ competitors: [acme], plan, looot, unpriced: ["adyntel-linkedin"], today: "2026-10-10" });
    expect(looot.calls.map((c) => c.endpointId)).toEqual(["adyntel-facebook"]);
    expect(report.runs.find((r) => r.endpointId === "adyntel-linkedin")?.state).toBe("blocked");
  });

  it("notes an empty answer", async () => {
    const spy = vi.fn(async () => ok("r", []));
    const report = await runPlan({ competitors: [acme], plan: buildPlan([acme], ["meta"], FALLBACK_PRICES, 1e6), looot: { runAndWait: spy }, today: "2026-10-10" });
    expect(report.runs[0].message).toMatch(/no ads/);
  });
});
