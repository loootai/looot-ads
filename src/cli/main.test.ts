import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FALLBACK_PRICES } from "@/lib/prices";
import { main, type CliDeps } from "./main";

function deps(over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const d: CliDeps = { log: (s) => out.push(s), err: (s) => err.push(s), env: {}, ...over };
  return { d, out, err };
}

describe("cli", () => {
  it("--dry-run prints the plan and the list-price total, and makes no call", async () => {
    let called = false;
    const { d, out } = deps({ looot: { runAndWait: async () => { called = true; throw new Error("no"); } } });
    const code = await main(["--competitors", "acme.com,Initech", "--dry-run"], d);
    expect(code).toBe(0);
    expect(called).toBe(false);
    expect(out.join("\n")).toMatch(/adyntel-facebook/);
    expect(out.join("\n")).toMatch(/skipped: Google Ads Transparency Center needs a domain/);
    expect(out.join("\n")).toMatch(/Dry run: no looot call was made/);
  });

  it("exits 2 with a clear message when LOOOT_TOKEN is missing", async () => {
    const { d, err } = deps();
    expect(await main(["--competitors", "acme.com"], d)).toBe(2);
    expect(err.join("")).toMatch(/LOOOT_TOKEN is not set/);
  });

  it("exits 2 on no competitors, a bad platform and a bad cap", async () => {
    expect(await main([], deps().d)).toBe(2);
    expect(await main(["--competitors", "a.com", "--platforms", "myspace", "--dry-run"], deps().d)).toBe(2);
    expect(await main(["--competitors", "a.com", "--max-spend", "0", "--dry-run"], deps().d)).toBe(2);
  });

  it("runs, writes json, csv and markdown, and exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ads-"));
    const { d } = deps({
      env: { LOOOT_TOKEN: "x" },
      looot: { runAndWait: async (e) => ({ runId: `r-${e}`, status: "completed", result: { ads: [{ id: e, title: "Save 30% off", is_active: true, start_date: "2026-09-01" }] }, actualCost: 0.001 }) },
      prices: async () => ({ prices: FALLBACK_PRICES, source: "catalog", unread: [] }),
    });
    const code = await main(["--competitors", "acme.com", "--platforms", "meta,linkedin", "--out", dir], d);
    expect(code).toBe(0);
    for (const f of ["ads.json", "ads.csv", "brief.md"]) expect(existsSync(join(dir, f))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "ads.json"), "utf8")).ads).toHaveLength(2);
  });

  it("exits 1 and says pending when a run is still going", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ads-"));
    const { d, out } = deps({
      env: { LOOOT_TOKEN: "x" },
      looot: { runAndWait: async () => ({ runId: "r", status: "running" }) },
      prices: async () => ({ prices: FALLBACK_PRICES, source: "catalog", unread: [] }),
    });
    expect(await main(["--competitors", "acme.com", "--platforms", "meta", "--out", dir], d)).toBe(1);
    expect(out.join("\n")).toMatch(/pending, not failed/);
  });

  it("--demo writes the invented-brand report without a token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ads-"));
    const { d } = deps();
    expect(await main(["--demo", "--out", dir], d)).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "ads.json"), "utf8")).mode).toBe("demo");
  });
});
