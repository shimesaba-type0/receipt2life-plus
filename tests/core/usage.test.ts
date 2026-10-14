import { beforeEach, describe, expect, it } from "vitest";
import { buildUsage, clearUsageCache, FREE_ROWS_READ_PER_DAY, getUsage, parseUsageRows } from "../../src/core/usage";

const ENV = { CF_API_TOKEN: "dummy-token", CF_ACCOUNT_ID: "dummy-account", D1_DATABASE_ID: "dummy-db" };
const NOW = new Date("2026-10-14T03:00:00Z");

const group = (date: string, over: Record<string, number> = {}) => ({ sum: { readQueries: 10, writeQueries: 2, rowsRead: 1000, rowsWritten: 20, ...over }, dimensions: { date } });
const gql = (groups: unknown[]) => ({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: groups }] } }, errors: null });
const reply = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

beforeEach(() => clearUsageCache());

describe("buildUsage / parseUsageRows", () => {
  it("欠けた日を 0 で埋めて、古い順に並べる。今日が最後", () => {
    const rows = parseUsageRows(gql([group("2026-10-13", { rowsRead: 500 }), group("2026-10-14")]))!;
    const { days, today } = buildUsage(rows, "2026-10-14", 5);
    expect(days.map((d) => d.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(days[0]).toMatchObject({ rows_read: 0, rows_written: 0 });
    expect(days[3]).toMatchObject({ rows_read: 500 });
    expect(today).toMatchObject({ date: "2026-10-14", rows_read: 1000, rows_written: 20, read_queries: 10, write_queries: 2 });
  });

  it("同じ日が複数あれば足す。形の違う応答は null、不正な値は 0", () => {
    const rows = parseUsageRows(gql([group("2026-10-14"), group("2026-10-14", { rowsRead: 5 }), { sum: { rowsRead: -1 }, dimensions: { date: "bad" } }]))!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rows_read: 1005 });
    expect(parseUsageRows({ data: null })).toBeNull();
    expect(parseUsageRows(gql([{ sum: { rowsRead: "x" }, dimensions: { date: "2026-10-14" } }]))![0]).toMatchObject({ rows_read: 0 });
  });
});

describe("getUsage", () => {
  it("設定が足りなければ configured: false(取りに行かない)。足りない項目名を返す", async () => {
    let called = false;
    const r = await getUsage({ CF_API_TOKEN: "x" }, { fetchImpl: (async () => ((called = true), new Response("{}"))) as typeof fetch, now: NOW });
    expect(r).toMatchObject({ ok: true, configured: false, missing: ["CF_ACCOUNT_ID", "D1_DATABASE_ID"] });
    expect(called).toBe(false);
  });

  it("設定があっても fetch が渡されなければ、取得できないエラー", async () => {
    expect(await getUsage(ENV, { now: NOW })).toMatchObject({ ok: false });
  });

  it("使用量と上限に対する割合・水準を返し、トークンはどこにも出さない", async () => {
    const r = await getUsage(ENV, { fetchImpl: reply(gql([group("2026-10-14", { rowsRead: 4_000_000, rowsWritten: 5_000 })])), now: NOW });
    expect(r.ok && r.configured && r).toMatchObject({ level: "warn", rows_read: { used: 4_000_000, limit: FREE_ROWS_READ_PER_DAY, level: "warn" }, rows_written: { used: 5_000, level: "ok" } });
    expect(r.ok && r.configured && r.days).toHaveLength(30);
    const text = JSON.stringify(r);
    for (const secret of ["dummy-token", "dummy-account", "dummy-db"]) expect(text).not.toContain(secret);
  });

  it("上限の90%以上は danger", async () => {
    const r = await getUsage(ENV, { fetchImpl: reply(gql([group("2026-10-14", { rowsWritten: 95_000 })])), now: NOW });
    expect(r.ok && r.configured && r.rows_written.level).toBe("danger");
    expect(r.ok && r.configured && r.level).toBe("danger");
  });

  it("Authorization ヘッダーでトークンを送り、5分間は同じ結果(2回目は取りに行かない)", async () => {
    let calls = 0;
    let auth = "";
    const f = (async (_url: string, init: RequestInit) => {
      calls++;
      auth = new Headers(init.headers).get("authorization") ?? "";
      return new Response(JSON.stringify(gql([group("2026-10-14")])));
    }) as unknown as typeof fetch;
    await getUsage(ENV, { fetchImpl: f, now: NOW });
    await getUsage(ENV, { fetchImpl: f, now: new Date(NOW.getTime() + 60_000) });
    expect(calls).toBe(1);
    expect(auth).toBe("Bearer dummy-token");
    await getUsage(ENV, { fetchImpl: f, now: new Date(NOW.getTime() + 6 * 60_000) });
    expect(calls).toBe(2);
  });

  it("失敗: 401・GraphQL のエラー・通信失敗・形の違う応答。いずれもトークンを含まない", async () => {
    const a = await getUsage(ENV, { fetchImpl: reply({}, 401), now: NOW });
    expect(!a.ok && a.errors[0]!.message).toContain("権限");
    clearUsageCache();
    const b = await getUsage(ENV, { fetchImpl: reply({ data: null, errors: [{ message: "not authorized for that account" }] }), now: NOW });
    expect(!b.ok && b.errors[0]!.message).toContain("not authorized");
    clearUsageCache();
    const c = await getUsage(ENV, { fetchImpl: (async () => { throw new Error("boom dummy-token"); }) as typeof fetch, now: NOW });
    expect(!c.ok && c.errors[0]!.message).toBe("Cloudflare への通信に失敗しました");
    clearUsageCache();
    const d = await getUsage(ENV, { fetchImpl: reply({ data: { viewer: {} } }), now: NOW });
    expect(d.ok).toBe(false);
    expect(JSON.stringify([a, b, c, d])).not.toContain("dummy-token");
  });
});
