import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, AUTH_BYPASS: "1" };
const app = createApp();
const post = (body: string, headers: Record<string, string> = {}) =>
  app.request("http://localhost/import", { method: "POST", body, headers }, local);

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
