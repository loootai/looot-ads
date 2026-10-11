import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as runRoute } from "@/app/api/run/route";
import { resetLimits } from "@/lib/auth/limits";
import { CSRF_HEADER, csrfToken, verifySession } from "@/lib/auth/session";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "LOOOT_ADS_DATA_DIR", "ADS_ADMIN_PASSWORD", "ADS_SPEND_CAP_USD", "LOOOT_ADS_DAILY_USD", "LOOOT_ADS_MONTHLY_USD", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method !== "POST") {
      res.statusCode = 200;
      return void res.end(JSON.stringify({ price: { state: "known", amountMicros: 1_880, unit: "call" } }));
    }
    paidRuns++;
    res.end(JSON.stringify({ runId: "r", status: "completed", result: { ads: [] }, actualCost: 0.00188 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  process.env.LOOOT_ADS_DATA_DIR = mkdtempSync(join(process.cwd(), ".vitest", "budget-route-"));
  process.env.ADS_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.ADS_SPEND_CAP_USD;
  delete process.env.LOOOT_ADS_DAILY_USD;
  delete process.env.LOOOT_ADS_MONTHLY_USD;
  paidRuns = 0;
  resetLimits();
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /ads_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
type S = Awaited<ReturnType<typeof session>>;
const call = (fn: (r: Request) => Promise<Response>, method: string, path: string, body: unknown, s: S) => fn(new Request(`http://localhost:3000${path}`, { method, headers: { ...H, cookie: s.cookie, [CSRF_HEADER]: s.token }, body: body === undefined ? undefined : JSON.stringify(body) }));
const read = async (s: S) => (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as { limits: { dailyMicros: number; monthlyMicros: number }; day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number } };
const PULL = { competitors: "acme.com", platforms: ["meta", "linkedin"] };
async function quoted(s: S, extra: Record<string, unknown> = {}) {
  const q = (await (await call(quote, "POST", "/api/quote", { ...PULL, ...extra }, s)).json()) as { quoteToken: string };
  return q.quoteToken;
}

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const j = await read(await session());
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
  });

  it("refuses to change the budget without the session", async () => {
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: H, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(401);
  });

  it("lets the signed-in owner change the budget", async () => {
    const s = await session();
    expect((await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 1, monthlyUsd: 3 }, s)).status).toBe(200);
    expect((await read(s)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
  });

  it("refuses a run request that carries a budget, and calls nothing", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.002 }, s);
    const token = await quoted(s);
    const res = await call(runRoute, "POST", "/api/run", { ...PULL, quoteToken: token, dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 } }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
    expect((await read(s)).limits.dailyMicros).toBe(1_000);
  });

  it("ignores a spend cap sent by the caller: the server cap holds", async () => {
    process.env.ADS_SPEND_CAP_USD = "0.002";
    const s = await session();
    const token = await quoted(s, { capUsd: 1000, capMicros: 1e12 });
    const res = await call(runRoute, "POST", "/api/run", { ...PULL, quoteToken: token, capUsd: 1000, capMicros: 1e12, spendCapUsd: 1000, maxSpend: 1000 }, s);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { spendMicros: number; runs: { state: string }[] };
    expect(paidRuns).toBe(1);
    expect(j.spendMicros).toBeLessThanOrEqual(2_000);
    expect(j.runs.map((r) => r.state)).toEqual(["completed", "blocked"]);
  });

  it("refuses a run above the owner's budget before any call", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.001 }, s);
    const token = await quoted(s);
    const res = await call(runRoute, "POST", "/api/run", { ...PULL, quoteToken: token }, s);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
  });

  it("does not charge a repeated identical run twice", async () => {
    const s = await session();
    const token = await quoted(s);
    expect((await call(runRoute, "POST", "/api/run", { ...PULL, quoteToken: token }, s)).status).toBe(200);
    const first = paidRuns;
    expect(first).toBe(2);
    expect((await call(runRoute, "POST", "/api/run", { ...PULL, quoteToken: await quoted(s) }, s)).status).toBe(200);
    expect(paidRuns).toBe(first);
    expect((await read(s)).day.usedMicros).toBe(3_760);
  });

  it("answers a repeat of a finished pull from the stored result even when the budget is nearly used up", async () => {
    const s = await session();
    expect((await call(runRoute, "POST", "/api/run", { ...PULL, quoteToken: await quoted(s) }, s)).status).toBe(200);
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.004, monthlyUsd: 0.004 }, s);
    const again = await call(runRoute, "POST", "/api/run", { ...PULL, quoteToken: await quoted(s) }, s);
    expect(again.status).toBe(200);
    expect(paidRuns).toBe(2);
    const other = await call(runRoute, "POST", "/api/run", { competitors: "globex.com", platforms: ["meta", "linkedin"], quoteToken: await (async () => ((await (await call(quote, "POST", "/api/quote", { competitors: "globex.com", platforms: ["meta", "linkedin"] }, s)).json()) as { quoteToken: string }).quoteToken)() }, s);
    expect(other.status).toBe(409);
    expect(paidRuns).toBe(2);
  });
});
