import { describe, expect, it } from "vitest";
import { parsePhotosAddQuery, parseRoute } from "../../ui/src/route";

describe("parseRoute", () => {
  it("ホーム", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("")).toEqual({ name: "home" });
  });
  it("カレンダー(月の指定あり・なし・不正)", () => {
    expect(parseRoute("/calendar")).toEqual({ name: "calendar", month: null });
    expect(parseRoute("/calendar/", "?month=2026-10")).toEqual({ name: "calendar", month: "2026-10" });
    expect(parseRoute("/calendar", "?month=abc")).toEqual({ name: "calendar", month: null });
  });
  it("日の詳細", () => {
    expect(parseRoute("/day/2026-10-11")).toEqual({ name: "day", date: "2026-10-11" });
    expect(parseRoute("/day/2026-1-1")).toEqual({ name: "notfound" });
  });
  it("明細ページは /tx/:id", () => {
    expect(parseRoute("/tx/abc123")).toEqual({ name: "transaction", id: "abc123" });
    expect(parseRoute("/tx/abc123/")).toEqual({ name: "transaction", id: "abc123" });
    expect(parseRoute("/tx/a%20b")).toEqual({ name: "transaction", id: "a b" });
    expect(parseRoute("/tx")).toEqual({ name: "notfound" });
    expect(parseRoute("/tx/")).toEqual({ name: "notfound" });
    expect(parseRoute("/tx/a/b")).toEqual({ name: "notfound" });
    expect(parseRoute("/tx/%E0%A4%A")).toEqual({ name: "notfound" });
    expect(parseRoute(`/tx/${"a".repeat(65)}`)).toEqual({ name: "notfound" });
  });
  it("バックアップ画面は /backup(/export と /import はWorkerのAPIなので、SPAでは扱わない)", () => {
    expect(parseRoute("/backup")).toEqual({ name: "backup" });
    expect(parseRoute("/backup/")).toEqual({ name: "backup" });
    expect(parseRoute("/export")).toEqual({ name: "notfound" });
    expect(parseRoute("/import")).toEqual({ name: "notfound" });
  });
  it("税額の画面は /tax(API の /api/tax-summary とは別)", () => {
    expect(parseRoute("/tax")).toEqual({ name: "tax" });
    expect(parseRoute("/tax/")).toEqual({ name: "tax" });
    expect(parseRoute("/tax/2026")).toEqual({ name: "notfound" });
  });

  it("カテゴリ画面は /categories(API の /api/categories とは別)", () => {
    expect(parseRoute("/categories")).toEqual({ name: "categories" });
    expect(parseRoute("/categories/")).toEqual({ name: "categories" });
    expect(parseRoute("/categories/食費")).toEqual({ name: "notfound" });
  });
  it("未知のパスは notfound", () => {
    expect(parseRoute("/nope")).toEqual({ name: "notfound" });
  });
});

describe("parsePhotosAddQuery", () => {
  it("date だけ", () => {
    expect(parsePhotosAddQuery("?date=2026-10-11")).toEqual({ ok: true, target: { date: "2026-10-11" } });
  });
  it("取引・出来事・キャプションを読む(前後の空白は除く)", () => {
    expect(parsePhotosAddQuery("?date=2026-10-11&transaction_id=tx1&event_id=ev1&caption=%20%E3%83%AC%E3%82%B7%E3%83%BC%E3%83%88%20")).toEqual({
      ok: true,
      target: { date: "2026-10-11", transaction_id: "tx1", event_id: "ev1", caption: "レシート" },
    });
  });
  it("空の任意項目は無いものとして扱う", () => {
    expect(parsePhotosAddQuery("?date=2026-10-11&transaction_id=&caption=%20")).toEqual({ ok: true, target: { date: "2026-10-11" } });
  });
  it("date が無い・形式が違う・実在しない日付は不正", () => {
    expect(parsePhotosAddQuery("").ok).toBe(false);
    expect(parsePhotosAddQuery("?transaction_id=tx1").ok).toBe(false);
    expect(parsePhotosAddQuery("?date=2026-1-1").ok).toBe(false);
    expect(parsePhotosAddQuery("?date=2026-02-30").ok).toBe(false);
    expect(parsePhotosAddQuery("?date=2026-13-01").ok).toBe(false);
    expect(parsePhotosAddQuery("?date=abc").ok).toBe(false);
  });
  it("うるう日は実在日だけ通す", () => {
    expect(parsePhotosAddQuery("?date=2028-02-29").ok).toBe(true);
    expect(parsePhotosAddQuery("?date=2027-02-29").ok).toBe(false);
  });
  it("長すぎる値は不正", () => {
    expect(parsePhotosAddQuery(`?date=2026-10-11&transaction_id=${"a".repeat(101)}`).ok).toBe(false);
    expect(parsePhotosAddQuery(`?date=2026-10-11&caption=${"a".repeat(201)}`).ok).toBe(false);
  });
});

describe("parseRoute /photos/add", () => {
  it("正しいクエリ", () => {
    expect(parseRoute("/photos/add", "?date=2026-10-11&event_id=ev1")).toEqual({
      name: "photosAdd",
      target: { date: "2026-10-11", event_id: "ev1" },
    });
    expect(parseRoute("/photos/add/", "?date=2026-10-11")).toEqual({ name: "photosAdd", target: { date: "2026-10-11" } });
  });
  it("不正なクエリは target が null", () => {
    expect(parseRoute("/photos/add", "")).toEqual({ name: "photosAdd", target: null });
    expect(parseRoute("/photos/add", "?date=2026-02-30")).toEqual({ name: "photosAdd", target: null });
  });
  it("/photos だけは notfound", () => {
    expect(parseRoute("/photos")).toEqual({ name: "notfound" });
  });
});
