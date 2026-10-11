import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

const X_POST = "https://x.com/example_user/status/1234567890";
const YT = "https://youtu.be/dQw4w9WgXcQ";

describe("リンクのAPI", () => {
  it("追加 → 日詳細に出る → 表題の更新 → 重複 → 削除", async () => {
    const add = await send("POST", "/api/links", { url: `${X_POST}?s=20`, title: "感想", date: "2026-10-10" });
    expect(add.status).toBe(200);
    expect(add.headers.get("cache-control")).toBe("private, no-store");
    const added = await json(add);
    expect(added).toMatchObject({ ok: true, duplicate: false, link: { url: X_POST, kind: "x", title: "感想", date: "2026-10-10", transaction_id: null, event_id: null } });
    const id = added.link.id as string;

    const day = await json(await call("/api/day/2026-10-10"));
    expect(day.links).toHaveLength(1);
    expect(day.links[0]).toMatchObject({ id, url: X_POST, kind: "x", title: "感想", created_at: expect.any(String) });
    expect((await json(await call("/api/day/2026-10-11"))).links).toEqual([]);

    const patch = await send("PATCH", `/api/links/${id}`, { title: null });
    expect(await json(patch)).toMatchObject({ ok: true, link: { id, title: null } });

    const dup = await json(await send("POST", "/api/links", { url: X_POST, date: "2026-10-10" }));
    expect(dup).toMatchObject({ ok: true, duplicate: true, link: { id } });

    const del = await send("DELETE", `/api/links/${id}`);
    expect(del.status).toBe(200);
    expect((await json(await call("/api/day/2026-10-10"))).links).toEqual([]);
    expect((await send("DELETE", `/api/links/${id}`)).status).toBe(404);
  });

  it("その日の取引・重なる出来事に付けたリンクも、日詳細に出る", async () => {
    const tx = await json(await send("POST", "/api/transactions", { transactions: [{ date: "2026-10-10", amount: 500, merchant: "A店", category: "食費" }] }));
    const ev = await json(await send("POST", "/api/events", { title: "旅行", start_date: "2026-10-09", end_date: "2026-10-11" }));
    await send("POST", "/api/links", { url: YT, transaction_id: tx.registered[0].id });
    await send("POST", "/api/links", { url: X_POST, event_id: ev.event.id });
    expect((await json(await call("/api/day/2026-10-10"))).links).toHaveLength(2);
    expect((await json(await call("/api/day/2026-10-12"))).links).toHaveLength(0);
  });

  it("検証エラーは400、存在しない id は404、PATCH で url は変えられない", async () => {
    const bad = await send("POST", "/api/links", { url: "http://x.com/example_user/status/1", date: "2026-10-10" });
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ ok: false, errors: [{ field: "url" }] });
    expect((await send("POST", "/api/links", { url: X_POST })).status).toBe(400);
    expect((await send("POST", "/api/links", { url: X_POST, event_id: "nope" })).status).toBe(400);
    expect((await send("PATCH", "/api/links/none", { title: "x" })).status).toBe(404);
    const add = await json(await send("POST", "/api/links", { url: YT, date: "2026-10-10" }));
    expect((await send("PATCH", `/api/links/${add.link.id}`, { title: "x", url: X_POST })).status).toBe(400);
  });

  it("JSON以外は415、壊れたJSONは400、別オリジンは403、長すぎる id は404", async () => {
    expect((await call("/api/links", { method: "POST", body: "url=x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/links", { method: "POST", body: "{", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await send("POST", "/api/links", { url: X_POST, date: "2026-10-10" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await send("DELETE", `/api/links/${"a".repeat(65)}`)).status).toBe(404);
    expect((await call("/api/links/x", { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  });

  it("取引・出来事の削除は、リンクがあっても通り、リンクも消える", async () => {
    const tx = await json(await send("POST", "/api/transactions", { transactions: [{ date: "2026-10-10", amount: 500, merchant: "A店", category: "食費" }] }));
    const ev = await json(await send("POST", "/api/events", { title: "旅行", start_date: "2026-10-09" }));
    await send("POST", "/api/links", { url: YT, transaction_id: tx.registered[0].id });
    await send("POST", "/api/links", { url: X_POST, event_id: ev.event.id });
    expect((await send("DELETE", `/api/transactions/${tx.registered[0].id}`)).status).toBe(200);
    expect((await send("DELETE", `/api/events/${ev.event.id}`)).status).toBe(200);
    expect((await testEnv().DB.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>())!.n).toBe(0);
  });
});
