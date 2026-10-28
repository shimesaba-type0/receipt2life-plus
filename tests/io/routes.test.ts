import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, AUTH_BYPASS: "1" };
const app = createApp();
const post = (body: string, headers: Record<string, string> = {}) =>
  app.request("http://localhost/import", { method: "POST", body, headers }, local);

describe("GET /api/transactions(要確認の一覧)", () => {
  it("status=needs_review で、要確認の取引だけを新しい順に返す", async () => {
    await post(
      [
        JSON.stringify({ type: "transaction", id: "r1", date: "2026-10-10", amount: 100, merchant: "A店", category: "食費" }),
        JSON.stringify({ type: "transaction", id: "r2", date: "2026-10-09", amount: 200, category: "食費" }),
        JSON.stringify({ type: "transaction", id: "r3", date: "2026-10-08", amount: 300, merchant: "B店" }),
      ].join("\n"),
    );
    const res = await app.request("http://localhost/api/transactions?status=needs_review", {}, local);
    const body = (await res.json()) as { ok: boolean; count: number; transactions: { id: string }[] };
    expect(body).toMatchObject({ ok: true, count: 2 });
    expect(body.transactions.map((t) => t.id)).toEqual(["r2", "r3"]);
    const ok = (await (await app.request("http://localhost/api/transactions?status=ok", {}, local)).json()) as { count: number };
    expect(ok.count).toBe(1);
    expect((await app.request("http://localhost/api/transactions?status=bad", {}, local)).status).toBe(400);
  });
});

describe("GET /export", () => {
  it("未認証は401", async () => {
    const res = await app.request("http://example.test/export", {}, { DB: testEnv().DB });
    expect(res.status).toBe(401);
  });

  it("JSONLをダウンロード用のヘッダーつきで返す", async () => {
    await post(JSON.stringify({ type: "transaction", id: "t1", date: "2026-10-10", amount: 100, merchant: "A店", category: "食費" }));
    const res = await app.request("http://localhost/export", {}, local);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="receipt2life-\d{8}\.jsonl"$/);
    const lines = new TextDecoder().decode(await res.arrayBuffer()).trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: "transaction", id: "t1", category: "食費" });
  });

  it("書き出すと履歴に1行入る。写真用の読み出し(?for=photos)は数えない", async () => {
    const count = async () => (await testEnv().DB.prepare("SELECT COUNT(*) AS n FROM backup_log").first<{ n: number }>())?.n;
    await app.request("http://localhost/export?for=photos", {}, local);
    expect(await count()).toBe(0);
    await app.request("http://localhost/export", {}, local);
    expect(await count()).toBe(1);
    const status = await app.request("http://localhost/api/backup-status", {}, local);
    expect(await status.json()).toMatchObject({ ok: true, days_since: 0 });
    const notices = await app.request("http://localhost/api/notices", {}, local);
    expect(await notices.json()).toEqual({ ok: true, notices: [] });
  });

  it("空のDBは200で空の本文", async () => {
    const res = await app.request("http://localhost/export", {}, local);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe("POST /import", () => {
  it("未認証は401", async () => {
    const res = await app.request("http://example.test/import", { method: "POST", body: "{}" }, { DB: testEnv().DB });
    expect(res.status).toBe(401);
  });

  it("行ごとの結果を返す。エラーがあってもHTTP 200", async () => {
    const body = [
      JSON.stringify({ type: "event", id: "e1", start_date: "2026-10-03", title: "出張" }),
      JSON.stringify({ type: "transaction", amount: -5 }),
    ].join("\n");
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      summary: { total: 2, ok: 1, skipped: 0, errors: 1 },
      results: [
        { line: 1, type: "event", status: "ok", id: "e1" },
        { line: 2, type: "transaction", status: "error" },
      ],
    });
  });

  it("JSON配列も受け付ける", async () => {
    const res = await post(JSON.stringify([{ type: "event", start_date: "2026-10-03", title: "出張" }]));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { summary: { ok: number } }).summary.ok).toBe(1);
  });

  it("本文が空なら400", async () => {
    const res = await post("");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: expect.stringContaining("空") });
  });

  it("大きすぎる本文は413(Content-Length でも、実際の大きさでも)", async () => {
    const res = await post("x".repeat(5 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: expect.stringContaining("5MB") });
    const res2 = await post("{}", { "content-length": String(6 * 1024 * 1024) });
    expect(res2.status).toBe(413);
  });
});
