import { describe, expect, it } from "vitest";
import { addBook, deleteBook, listBooks, normalizeIsbn, updateBook } from "../../src/core/books";
import { addTransactions } from "../../src/core/transactions";
import { testEnv } from "../helpers";

const NOW = new Date("2026-10-11T03:00:00Z");
const db = () => testEnv().DB;

// 公開されている例の ISBN(ダミー用の番号。実在の書籍と対応させない)
const ISBN13 = "9784000000000";
const ISBN10 = "4000000004";

describe("normalizeIsbn", () => {
  it("ハイフン・空白を取り、10桁は13桁にそろえる。チェックディジットが違えば null", () => {
    expect(normalizeIsbn("978-4-00-000000-0")).toBe(ISBN13);
    expect(normalizeIsbn(" 9784000000000 ")).toBe(ISBN13);
    expect(normalizeIsbn("4-00-000000-4")).toBe(ISBN13);
    expect(normalizeIsbn(ISBN10)).toBe(ISBN13);
    expect(normalizeIsbn("9784000000001")).toBeNull();
    expect(normalizeIsbn("400000000X")).toBeNull();
    expect(normalizeIsbn("12345")).toBeNull();
  });
});

describe("本の記録", () => {
  it("ISBN かタイトルのどちらかは必須。ISBN が正しくなければエラー", async () => {
    const none = await addBook(db(), { author: "ダミー著者" }, { now: NOW });
    expect(none.ok).toBe(false);
    const bad = await addBook(db(), { isbn: "9784000000001" }, { now: NOW });
    expect(bad).toMatchObject({ ok: false, errors: [{ field: "isbn" }] });
    const unknown = await addBook(db(), { title: "ダミー", foo: 1 }, { now: NOW });
    expect(unknown.ok).toBe(false);
  });

  it("登録して、13桁のISBNで返る。同じ ISBN があると知らせる", async () => {
    const a = await addBook(db(), { isbn: "978-4-00-000000-0", title: "ダミー本1", author: "ダミー著者", series: "ダミーシリーズ", buyer: "ダミー太郎", note: "メモ", purchased_on: "2026-10-01" }, { now: NOW });
    expect(a).toMatchObject({ ok: true, book: { isbn: ISBN13, title: "ダミー本1", series: "ダミーシリーズ", buyer: "ダミー太郎", purchased_on: "2026-10-01" } });
    const b = await addBook(db(), { isbn: ISBN10, title: "ダミー本1" }, { now: NOW });
    expect(b.ok && b.message).toContain("同じ ISBN の本が、ほかに1件");
  });

  it("買った日が無ければ、紐づけた取引の日付になる。存在しない取引はエラー", async () => {
    const tx = await addTransactions(db(), { transactions: [{ date: "2026-10-05", amount: 1500, merchant: "ダミー書店", category: "その他", account: "現金" }] }, { now: NOW });
    const txId = tx.ok ? tx.registered[0]!.id : "";
    const linked = await addBook(db(), { title: "ダミー本2", transaction_id: txId }, { now: NOW });
    expect(linked).toMatchObject({ ok: true, book: { purchased_on: "2026-10-05", transaction_id: txId } });
    const missing = await addBook(db(), { title: "ダミー本3", transaction_id: "nope" }, { now: NOW });
    expect(missing).toMatchObject({ ok: false, errors: [{ field: "transaction_id" }] });
    // 自分で買った日を入れれば、そちらを優先する
    const own = await addBook(db(), { title: "ダミー本4", transaction_id: txId, purchased_on: "2026-10-02" }, { now: NOW });
    expect(own.ok && own.book.purchased_on).toBe("2026-10-02");
  });

  it("絞り込み: 言葉・シリーズ・購入者・期間・紐づけなし。候補(facets)も返る", async () => {
    await addBook(db(), { title: "ダミー本A", author: "著者X", series: "シリーズ1", buyer: "ダミー太郎", purchased_on: "2026-09-01", note: "面白い" }, { now: NOW });
    await addBook(db(), { title: "ダミー本B", author: "著者Y", series: "シリーズ1", buyer: "ダミー花子", purchased_on: "2026-10-01" }, { now: NOW });
    await addBook(db(), { isbn: ISBN13, author: "著者X", purchased_on: "2026-10-05" }, { now: NOW });
    const all = await listBooks(db(), {});
    expect(all).toMatchObject({ ok: true, count: 3, facets: { series: ["シリーズ1"], authors: ["著者X", "著者Y"], buyers: ["ダミー太郎", "ダミー花子"].sort() } });
    expect(all.ok && all.records.map((r) => r.purchased_on)).toEqual(["2026-10-05", "2026-10-01", "2026-09-01"]);
    const bySeries = await listBooks(db(), { series: "シリーズ1" });
    expect(bySeries.ok && bySeries.count).toBe(2);
    const byWord = await listBooks(db(), { q: "著者X 面白い" });
    expect(byWord.ok && byWord.records.map((r) => r.title)).toEqual(["ダミー本A"]);
    const byIsbn = await listBooks(db(), { isbn: ISBN10 });
    expect(byIsbn.ok && byIsbn.count).toBe(1);
    const byRange = await listBooks(db(), { from: "2026-10-01", to: "2026-10-31" });
    expect(byRange.ok && byRange.count).toBe(2);
    const unlinked = await listBooks(db(), { unlinked: true });
    expect(unlinked.ok && unlinked.count).toBe(3);
    expect(await listBooks(db(), { from: "2026-11-01", to: "2026-10-01" })).toMatchObject({ ok: false });
  });

  it("ページ送り: limit と offset。件数は全件で数える", async () => {
    for (let i = 1; i <= 5; i++) await addBook(db(), { title: `ダミー本${i}`, purchased_on: `2026-10-0${i}` }, { now: NOW });
    const p1 = await listBooks(db(), { limit: 2 });
    expect(p1.ok && p1.records.map((r) => r.title)).toEqual(["ダミー本5", "ダミー本4"]);
    expect(p1.ok && p1.count).toBe(5);
    const p3 = await listBooks(db(), { limit: 2, offset: 4 });
    expect(p3.ok && p3.records.map((r) => r.title)).toEqual(["ダミー本1"]);
    const past = await listBooks(db(), { limit: 2, offset: 10 });
    expect(past).toMatchObject({ ok: true, count: 5, records: [] });
  });

  it("直す・消す。ISBN とタイトルの両方は消せない", async () => {
    const a = await addBook(db(), { isbn: ISBN13, title: "ダミー本", author: "著者X", purchased_on: "2026-10-01" }, { now: NOW });
    const id = a.ok ? a.book.id : "";
    const u = await updateBook(db(), { id, title: "直したタイトル", author: null, series: "新シリーズ" });
    expect(u).toMatchObject({ ok: true, book: { title: "直したタイトル", author: null, series: "新シリーズ", isbn: ISBN13, purchased_on: "2026-10-01" } });
    expect(await updateBook(db(), { id })).toMatchObject({ ok: false });
    expect(await updateBook(db(), { id, isbn: null, title: "" })).toMatchObject({ ok: false, errors: [{ field: "title" }] });
    expect(await updateBook(db(), { id: "nope", note: "x" })).toMatchObject({ ok: false, errors: [{ field: "id" }] });
    expect(await deleteBook(db(), { id })).toMatchObject({ ok: true });
    expect(await deleteBook(db(), { id })).toMatchObject({ ok: false });
  });

  it("カバー画像のURLは https だけ。直す・消すこともできる", async () => {
    const bad = await addBook(db(), { title: "ダミー", cover_url: "http://example.test/c.jpg" }, { now: NOW });
    expect(bad).toMatchObject({ ok: false, errors: [{ field: "cover_url" }] });
    const a = await addBook(db(), { title: "ダミー本", cover_url: "https://example.test/c.jpg#x" }, { now: NOW });
    expect(a).toMatchObject({ ok: true, book: { cover_url: "https://example.test/c.jpg" } });
    const id = a.ok ? a.book.id : "";
    expect(await updateBook(db(), { id, cover_url: "https://example.test/d.jpg" })).toMatchObject({ ok: true, book: { cover_url: "https://example.test/d.jpg" } });
    expect(await updateBook(db(), { id, cover_url: "ftp://example.test/d.jpg" })).toMatchObject({ ok: false });
    expect(await updateBook(db(), { id, cover_url: null })).toMatchObject({ ok: true, book: { cover_url: null } });
  });

  it("取引を消しても本の記録は残り、紐づけだけ外れる", async () => {
    const tx = await addTransactions(db(), { transactions: [{ date: "2026-10-05", amount: 1500, merchant: "ダミー書店", category: "その他", account: "現金" }] }, { now: NOW });
    const txId = tx.ok ? tx.registered[0]!.id : "";
    const a = await addBook(db(), { title: "ダミー本", transaction_id: txId }, { now: NOW });
    await db().prepare("DELETE FROM transactions WHERE id = ?").bind(txId).run();
    const got = await listBooks(db(), {});
    expect(got.ok && got.records[0]).toMatchObject({ id: a.ok ? a.book.id : "", transaction_id: null, purchased_on: null });
  });
});
