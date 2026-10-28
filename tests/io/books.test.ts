import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, AUTH_BYPASS: "1" };
const app = createApp();
const post = (body: string) => app.request("http://localhost/import", { method: "POST", body }, local);
const exportLines = async () => (await (await app.request("http://localhost/export", {}, local)).text()).trimEnd().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

describe("本の記録のバックアップ(エクスポートとインポート)", () => {
  it("書き出して、読み込める。同じ id は重複としてスキップする。10桁の ISBN は13桁にそろう", async () => {
    const lines = [
      JSON.stringify({ type: "transaction", id: "t1", date: "2026-10-05", amount: 1500, merchant: "ダミー書店", category: "その他" }),
      JSON.stringify({ type: "book", id: "b1", isbn: "4-00-000000-4", title: "ダミー本", author: "ダミー著者", series: "ダミーシリーズ", buyer: "ダミー太郎", note: "メモ", cover_url: "https://example.test/c.jpg", transaction_id: "t1", created_at: "2026-10-05T00:00:00.000Z" }),
      JSON.stringify({ type: "book", id: "b2", title: "タイトルだけ", purchased_on: "2026-09-01", status: "sold", released_on: "2026-10-01" }),
    ].join("\n");
    const res = await post(lines);
    expect(await res.json()).toMatchObject({ ok: true, summary: { total: 3, ok: 3, errors: 0 } });

    const exported = (await exportLines()).filter((r) => r.type === "book");
    expect(exported).toEqual([
      { type: "book", id: "b1", isbn: "9784000000000", title: "ダミー本", author: "ダミー著者", series: "ダミーシリーズ", buyer: "ダミー太郎", note: "メモ", cover_url: "https://example.test/c.jpg", status: "owned", released_on: null, purchased_on: null, transaction_id: "t1", created_at: "2026-10-05T00:00:00.000Z" },
      { type: "book", id: "b2", isbn: null, title: "タイトルだけ", author: null, series: null, buyer: null, note: null, cover_url: null, status: "sold", released_on: "2026-10-01", purchased_on: "2026-09-01", transaction_id: null, created_at: expect.any(String) },
    ]);

    // 書き出したものを、そのまま読み込み直しても、重複としてスキップされる
    const again = await post(
      (await exportLines())
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    expect(await again.json()).toMatchObject({ ok: true, summary: { errors: 0, ok: 0 } });
  });

  it("お気に入りシリーズも、書き出して読み込める。同じシリーズは何度戻しても増えない", async () => {
    const lines = [
      JSON.stringify({ type: "book", id: "f1", title: "ダミー本", series: "シリーズ1" }),
      JSON.stringify({ type: "favorite_series", series: "シリーズ1", created_at: "2026-10-05T00:00:00.000Z" }),
      JSON.stringify({ type: "favorite_series", series: "" }),
    ].join("\n");
    const res = (await (await post(lines)).json()) as { summary: { ok: number; errors: number } };
    expect(res.summary).toMatchObject({ ok: 2, errors: 1 });
    const exported = (await exportLines()).filter((r) => r.type === "favorite_series");
    expect(exported).toEqual([{ type: "favorite_series", id: "シリーズ1", series: "シリーズ1", created_at: "2026-10-05T00:00:00.000Z" }]);
    const again = await post(
      (await exportLines())
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    expect(await again.json()).toMatchObject({ ok: true, summary: { errors: 0, ok: 0 } });
  });

  it("ISBN の誤り、ISBN もタイトルもない行、存在しない取引は、その行だけエラー", async () => {
    const lines = [
      JSON.stringify({ type: "book", id: "x1", isbn: "9784000000001", title: "ダミー" }),
      JSON.stringify({ type: "book", id: "x2", author: "ダミー著者" }),
      JSON.stringify({ type: "book", id: "x3", title: "ダミー", transaction_id: "nope" }),
      JSON.stringify({ type: "book", id: "x4", title: "正しい行" }),
      JSON.stringify({ type: "book", id: "x5", title: "状況の誤り", status: "borrowed" }),
      JSON.stringify({ type: "book", id: "x6", title: "手元にあるのに手放した日", status: "owned", released_on: "2026-10-01" }),
    ].join("\n");
    const res = (await (await post(lines)).json()) as { summary: { ok: number; errors: number }; results: { status: string }[] };
    expect(res.summary).toMatchObject({ ok: 1, errors: 5 });
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "error", "ok", "error", "error"]);
  });
});

describe("本の記録のAPI", () => {
  const json = (method: string, path: string, body?: unknown) =>
    app.request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", origin: "http://localhost" }, body: body === undefined ? undefined : JSON.stringify(body) }, local);

  it("登録・一覧(絞り込み)・直す・消す", async () => {
    const created = (await (await json("POST", "/api/books", { title: "ダミー本", isbn: "9784000000000", series: "S1" })).json()) as { ok: boolean; book: { id: string } };
    expect(created.ok).toBe(true);
    const list = (await (await app.request("http://localhost/api/books?series=S1&limit=10", {}, local)).json()) as { count: number; facets: { series: string[] } };
    expect(list).toMatchObject({ count: 1, facets: { series: ["S1"] } });
    const fav = await json("PUT", "/api/book-favorites", { series: "S1", favorite: true });
    expect(await fav.json()).toMatchObject({ ok: true, favorite: true });
    const favList = (await (await app.request("http://localhost/api/books?favorite=1", {}, local)).json()) as { count: number; records: { series_favorite: boolean }[] };
    expect(favList).toMatchObject({ count: 1, records: [{ series_favorite: true }] });
    expect((await json("PUT", "/api/book-favorites", { series: "ない", favorite: true })).status).toBe(400);
    const none = (await (await app.request("http://localhost/api/books?q=ない言葉", {}, local)).json()) as { count: number };
    expect(none.count).toBe(0);
    const one = await app.request(`http://localhost/api/books/${created.book.id}`, {}, local);
    expect(await one.json()).toMatchObject({ ok: true, book: { id: created.book.id, title: "ダミー本" } });
    expect((await app.request("http://localhost/api/books/nope", {}, local)).status).toBe(404);
    const patched = await json("PATCH", `/api/books/${created.book.id}`, { author: "著者" });
    expect(await patched.json()).toMatchObject({ ok: true, book: { author: "著者" } });
    const bad = await json("POST", "/api/books", { author: "だけ" });
    expect(bad.status).toBe(400);
    const del = await json("DELETE", `/api/books/${created.book.id}`);
    expect(await del.json()).toMatchObject({ ok: true });
    expect((await json("DELETE", `/api/books/${created.book.id}`)).status).toBe(404);
  });

  it("未認証は401", async () => {
    expect((await app.request("http://example.test/api/books", {}, { DB: testEnv().DB })).status).toBe(401);
  });
});
