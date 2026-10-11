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

describe("GET /api/categories", () => {
  it("大分類ごと・追加順で、usage を含む", async () => {
    await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 100, merchant: "A店", category: "食費" }] });
    const res = await call("/api/categories");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await json(res);
    expect(body.categories[0]).toEqual({ name: "食費", group_name: "食費", usage: 1 });
    expect(body.categories[1]).toEqual({ name: "日用品", group_name: "生活", usage: 0 });
    expect(body.accounts).toEqual(["現金", "カード", "Suica"]);
  });
});

describe("POST /api/categories", () => {
  it("追加できる(新しい大分類も)", async () => {
    const res = await send("POST", "/api/categories", { name: "家賃", group_name: "住まい" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, category: { name: "家賃", group_name: "住まい", usage: 0 }, created_group: true });
    const list = await json(await call("/api/categories"));
    expect(list.categories.at(-1)).toEqual({ name: "家賃", group_name: "住まい", usage: 0 });
  });

  it("重複・空は400でフィールド名つき", async () => {
    const dup = await send("POST", "/api/categories", { name: "食費", group_name: "食費" });
    expect(dup.status).toBe(400);
    expect(await json(dup)).toMatchObject({ ok: false, errors: [{ field: "name" }] });
    const empty = await send("POST", "/api/categories", { name: " ", group_name: "x" });
    expect(empty.status).toBe(400);
  });

  it("JSONでなければ415、壊れたJSONは400", async () => {
    const res = await call("/api/categories", { method: "POST", body: "name=x", headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(415);
    const bad = await call("/api/categories", { method: "POST", body: "{", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
  });

  it("別オリジンからは403(CSRF)", async () => {
    const res = await send("POST", "/api/categories", { name: "x", group_name: "y" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    const site = await send("DELETE", `/api/categories/${enc("娯楽")}`, undefined, { "sec-fetch-site": "cross-site" });
    expect(site.status).toBe(403);
    expect((await json(await call("/api/categories"))).categories.map((c: { name: string }) => c.name)).toContain("娯楽");
  });
});

describe("PATCH /api/categories/:name", () => {
  it("日本語の名前(URLエンコード)で、名前変更と大分類の移動ができる", async () => {
    const res = await send("PATCH", `/api/categories/${enc("交通・チャージ")}`, { new_name: "電車", group_name: "移動" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, category: { name: "電車", group_name: "移動" }, created_group: true });
  });

  it("記号を含む名前(/ ? # %)もURLエンコードで指せる", async () => {
    for (const name of ["A/B", "ほか?", "#1", "50%"]) {
      expect((await send("POST", "/api/categories", { name, group_name: "記号" })).status).toBe(200);
      const patched = await send("PATCH", `/api/categories/${enc(name)}`, { new_name: `${name}x` });
      expect(patched.status, name).toBe(200);
      expect((await call(`/api/categories/${enc(`${name}x`)}`, { method: "DELETE" })).status, name).toBe(200);
    }
  });

  it("パスの name が本文の name に優先する", async () => {
    const res = await send("PATCH", `/api/categories/${enc("娯楽")}`, { name: "食費", new_name: "趣味" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ category: { name: "趣味" } });
  });

  it("存在しないものは404、重複は400、変更なしは400", async () => {
    expect((await send("PATCH", `/api/categories/${enc("なぞ")}`, { new_name: "x" })).status).toBe(404);
    expect((await send("PATCH", `/api/categories/${enc("娯楽")}`, { new_name: "食費" })).status).toBe(400);
    expect((await send("PATCH", `/api/categories/${enc("娯楽")}`, {})).status).toBe(400);
  });

  it("JSONでなければ415", async () => {
    const res = await call(`/api/categories/${enc("娯楽")}`, { method: "PATCH", body: "x", headers: { "content-type": "text/plain" } });
    expect(res.status).toBe(415);
  });
});

describe("DELETE /api/categories/:name", () => {
  it("使われていなければ削除できる", async () => {
    const res = await call(`/api/categories/${enc("娯楽")}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, deleted: { name: "娯楽" }, moved: 0 });
  });

  it("使用中は move_to が必要。付ければ付け替えて削除する", async () => {
    await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 100, merchant: "A店", category: "娯楽" }] });
    const refused = await call(`/api/categories/${enc("娯楽")}`, { method: "DELETE" });
    expect(refused.status).toBe(400);
    expect((await json(refused)).errors[0]).toMatchObject({ field: "move_to" });

    const ok = await call(`/api/categories/${enc("娯楽")}?move_to=${enc("その他")}`, { method: "DELETE" });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ ok: true, moved: 1, move_to: "その他" });
    const day = await json(await call(`/api/day/${todayJst()}`));
    expect(day.transactions[0].category).toBe("その他");
  });

  it("存在しないものは404", async () => {
    expect((await call(`/api/categories/${enc("なぞ")}`, { method: "DELETE" })).status).toBe(404);
  });
});

describe("POST /api/category-groups/rename", () => {
  it("大分類の名前を変える(件数を返す)", async () => {
    const res = await send("POST", "/api/category-groups/rename", { group: "生活", new_name: "暮らし" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, group: "暮らし", previous: "生活", updated: 1, merged: false });
  });

  it("既存と同名なら統合", async () => {
    const res = await send("POST", "/api/category-groups/rename", { group: "交通", new_name: "生活" });
    expect(await json(res)).toMatchObject({ ok: true, merged: true });
  });

  it("存在しない大分類は404、415、403", async () => {
    expect((await send("POST", "/api/category-groups/rename", { group: "なぞ", new_name: "x" })).status).toBe(404);
    expect((await call("/api/category-groups/rename", { method: "POST", body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await send("POST", "/api/category-groups/rename", { group: "生活", new_name: "x" }, { origin: "https://evil.example" })).status).toBe(403);
  });
});
