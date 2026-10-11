import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as run } from "@/app/api/run/route";
import { proxy } from "@/proxy";
import { serverCapMicros } from "@/lib/spend";
import { resetLimits } from "./limits";
import { createQuoteToken, csrfToken, pullDigest, verifySession } from "./session";

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
const KEYS = ["ADS_ADMIN_PASSWORD", "ADS_SPEND_CAP_USD", "LOOOT_ADS_DATA_DIR", "LOOOT_TOKEN", "NEXT_PUBLIC_DEMO", "LOOOT_API_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /ads_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";

beforeEach(() => {
  process.env.ADS_ADMIN_PASSWORD = PW;
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.ADS_SPEND_CAP_USD;
  process.env.LOOOT_ADS_DATA_DIR = join(tmpdir(), "looot-ads-flow-test");
  resetLimits();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function session() {
  const res = await login(post("/api/auth/login", { password: PW }));
  const cookie = cookieOf(res);
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, sid: s.sid, token: await csrfToken(process.env, s.sid) };
}

describe("sign in", () => {
  it("a wrong password gets 401 and no cookie", async () => {
    const res = await login(post("/api/auth/login", { password: "nope-nope-nope-nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("the right password sets a hardened cookie that opens admin pages", async () => {
    const res = await login(post("/api/auth/login", { password: PW }));
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Max-Age=/);
    const page = await proxy(new NextRequest("http://localhost:3000/new", { headers: { cookie: cookieOf(res) } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
  it("a form post redirects to the page asked for, and never off site", async () => {
    const form = (next: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { host: H.host, origin: H.origin, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": H["x-forwarded-for"] }, body: new URLSearchParams({ password: PW, next }) });
    expect((await login(form("/new"))).headers.get("location")).toBe("/new");
    expect((await login(form("//evil.example"))).headers.get("location")).toBe("/");
    expect((await login(form("https://evil.example"))).headers.get("location")).toBe("/");
  });
  it("locks the address after 5 wrong passwords, and the right password does not help until the window ends", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", { password: `wrong-password-${i}-xx` }))).status).toBe(401);
    const locked = await login(post("/api/auth/login", { password: PW }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
  });
  it("refuses a sign-in posted from another site", async () => {
    expect((await login(post("/api/auth/login", { password: PW }, { origin: "https://evil.example" }))).status).toBe(403);
  });
  it("sign out clears the cookie, and only for a same-site request", async () => {
    expect((await logout(post("/api/auth/logout", {}))).headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("CSRF on state-changing admin requests", () => {
  const body = { competitors: "acme.com", platforms: ["meta"] };
  it("rejects a cross-site origin even with a valid session", async () => {
    const { cookie, token } = await session();
    expect((await quote(post("/api/quote", body, { cookie, "x-ads-csrf": token, origin: "https://evil.example" }))).status).toBe(403);
  });
  it("rejects a same-origin request without the token, or with someone else's", async () => {
    const { cookie } = await session();
    expect((await quote(post("/api/quote", body, { cookie }))).status).toBe(403);
    expect((await quote(post("/api/quote", body, { cookie, "x-ads-csrf": "AAAA" }))).status).toBe(403);
    expect((await run(post("/api/run", body, { cookie }))).status).toBe(403);
  });
  it("a request with no Origin and no fetch metadata is refused", async () => {
    const { cookie, token } = await session();
    const res = await quote(new Request("http://localhost:3000/api/quote", { method: "POST", headers: { host: H.host, cookie, "x-ads-csrf": token }, body: JSON.stringify(body) }));
    expect(res.status).toBe(403);
  });
});

describe("spend cap comes from the server", () => {
  it("reads ADS_SPEND_CAP_USD, defaults to $1, and clamps a typo", () => {
    expect(serverCapMicros({})).toBe(1_000_000);
    expect(serverCapMicros({ ADS_SPEND_CAP_USD: "2.5" })).toBe(2_500_000);
    expect(serverCapMicros({ ADS_SPEND_CAP_USD: "junk" })).toBe(1_000_000);
    expect(serverCapMicros({ ADS_SPEND_CAP_USD: "-4" })).toBe(1_000_000);
    expect(serverCapMicros({ ADS_SPEND_CAP_USD: "999999" })).toBe(100_000_000);
  });
  it("a caller-supplied cap in the quote request is ignored", async () => {
    process.env.ADS_SPEND_CAP_USD = "0.50";
    process.env.LOOOT_API_URL = "http://127.0.0.1:9";
    const { cookie, token } = await session();
    const res = await quote(post("/api/quote", { competitors: "acme.com", platforms: ["meta"], maxSpendUsd: 9999, capMicros: 9_999_000_000 }, { cookie, "x-ads-csrf": token }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plan.capMicros).toBe(500_000);
    expect(typeof json.quoteToken).toBe("string");
  });
});

describe("quote step before a paid run", () => {
  const body = { competitors: "acme.com", platforms: ["meta"] };
  beforeEach(() => {
    process.env.LOOOT_TOKEN = "lt_fake_local_token";
    process.env.LOOOT_API_URL = "http://127.0.0.1:9";
  });
  it("refuses a run with no quote token", async () => {
    const { cookie, token } = await session();
    const res = await run(post("/api/run", body, { cookie, "x-ads-csrf": token }));
    expect(res.status).toBe(400);
  });
  it("refuses a made-up quote token, and the old confirmedTotalMicros field does nothing", async () => {
    const { cookie, token } = await session();
    const a = await run(post("/api/run", { ...body, quoteToken: "1.1.AAAA" }, { cookie, "x-ads-csrf": token }));
    expect(a.status).toBe(409);
    const b = await run(post("/api/run", { ...body, confirmedTotalMicros: 999_999_999 }, { cookie, "x-ads-csrf": token }));
    expect(b.status).toBe(400);
  });
  it("refuses a token signed for a different pull, a different session, or an expired one", async () => {
    const { cookie, token, sid } = await session();
    const other = await createQuoteToken(process.env, sid, 1_000_000, await pullDigest(["someone-else"], ["meta"]));
    expect((await run(post("/api/run", { ...body, quoteToken: other }, { cookie, "x-ads-csrf": token }))).status).toBe(409);
    const foreign = await createQuoteToken(process.env, "another-session-id", 1_000_000, await pullDigest(["acme"], ["meta"]));
    expect((await run(post("/api/run", { ...body, quoteToken: foreign }, { cookie, "x-ads-csrf": token }))).status).toBe(409);
    const expired = await createQuoteToken(process.env, sid, 1_000_000, await pullDigest(["acme"], ["meta"]), Date.now() - 3_600_000);
    expect((await run(post("/api/run", { ...body, quoteToken: expired }, { cookie, "x-ads-csrf": token }))).status).toBe(409);
  });
  it("limits paid runs per session", async () => {
    const { cookie, token, sid } = await session();
    const { parseCompetitorList } = await import("@/lib/sources");
    const ids = parseCompetitorList("acme.com").map((c) => c.id);
    const good = await createQuoteToken(process.env, sid, 1, await pullDigest(ids, ["meta"]));
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await run(post("/api/run", { ...body, quoteToken: good }, { cookie, "x-ads-csrf": token }))).status);
    expect(statuses.slice(0, 6).every((s) => s !== 429)).toBe(true);
    expect(statuses[6]).toBe(429);
  }, 60_000);
});

describe("demo mode", () => {
  it("is open with a quote and never runs", async () => {
    delete process.env.ADS_ADMIN_PASSWORD;
    delete process.env.LOOOT_TOKEN;
    process.env.LOOOT_ADS_DATA_DIR = "/nonexistent/looot-ads-test";
    process.env.NEXT_PUBLIC_DEMO = "1";
    expect((await proxy(new NextRequest("http://localhost:3000/new"))).status).toBe(200);
    const q = await quote(post("/api/quote", { competitors: "acme.com", platforms: ["meta"] }));
    expect(q.status).toBe(200);
    expect((await q.json()).quoteToken).toBeNull();
  });
});
