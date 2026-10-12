import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;
const enc = encodeURIComponent;

describe("GET /api/accounts", () => {
  it("追加順で、usage を含む。GET /api/categories の accounts は名前の配列のまま", async () => {
    await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 100, merchant: "A店", category: "食費", account: "カード" }] });
    const res = await call("/api/accounts");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await json(res)).accounts).toEqual([
      { name: "現金", usage: 0 },
      { name: "カード", usage: 1 },
      { name: "Suica", usage: 0 },
    ]);
    expect((await json(await call("/api/categories"))).accounts).toEqual(["現金", "カード", "Suica"]);
  });
});

describe("POST /api/accounts", () => {
  it("追加できる", async () => {
    const res = await send("POST", "/api/accounts", { name: "電子マネーA" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, account: { name: "電子マネーA", usage: 0 } });
    expect((await json(await call("/api/categories"))).accounts).toContain("電子マネーA");
  });

  it("重複・空は400でフィールド名つき", async () => {
    const dup = await send("POST", "/api/accounts", { name: "現金" });
    expect(dup.status).toBe(400);
    expect(await json(dup)).toMatchObject({ ok: false, errors: [{ field: "name" }] });
    expect((await send("POST", "/api/accounts", { name: " " })).status).toBe(400);
  });

  it("JSONでなければ415、壊れたJSONは400、別オリジンは403", async () => {
    expect((await call("/api/accounts", { method: "POST", body: "name=x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/accounts", { method: "POST", body: "{", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await send("POST", "/api/accounts", { name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await send("PATCH", `/api/accounts/${enc("現金")}`, { new_name: "x" }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send("DELETE", `/api/accounts/${enc("現金")}`, undefined, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await json(await call("/api/categories"))).accounts).toEqual(["現金", "カード", "Suica"]);
  });
});

describe("PATCH /api/accounts/:name", () => {
  it("名前を変えられる。存在しなければ404、重複は400", async () => {
    const res = await send("PATCH", `/api/accounts/${enc("Suica")}`, { new_name: "交通IC" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, account: { name: "交通IC" } });
    expect((await send("PATCH", `/api/accounts/${enc("なし")}`, { new_name: "x" })).status).toBe(404);
    expect((await send("PATCH", `/api/accounts/${enc("現金")}`, { new_name: "カード" })).status).toBe(400);
  });

  it("JSONでなければ415", async () => {
    const res = await call(`/api/accounts/${enc("現金")}`, { method: "PATCH", body: "x", headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(415);
  });
});

describe("DELETE /api/accounts/:name", () => {
  it("未使用は削除できる。存在しなければ404", async () => {
    const res = await send("DELETE", `/api/accounts/${enc("Suica")}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, deleted: { name: "Suica" }, moved: 0 });
    expect((await send("DELETE", `/api/accounts/${enc("Suica")}`)).status).toBe(404);
  });

  it("使用中は move_to が必要(無いと400)。付けると付け替えて削除", async () => {
    await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 100, merchant: "A店", category: "食費", account: "カード" }] });
    const refused = await send("DELETE", `/api/accounts/${enc("カード")}`);
    expect(refused.status).toBe(400);
    expect(await json(refused)).toMatchObject({ ok: false, errors: [{ field: "move_to" }] });
    const ok = await send("DELETE", `/api/accounts/${enc("カード")}?move_to=${enc("現金")}`);
    expect(await json(ok)).toMatchObject({ ok: true, moved: 1, move_to: "現金" });
    expect((await json(await call("/api/accounts"))).accounts[0]).toEqual({ name: "現金", usage: 1 });
  });
});
