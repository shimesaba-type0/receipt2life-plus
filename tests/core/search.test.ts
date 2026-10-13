import { beforeEach, describe, expect, it } from "vitest";
import { addEvent } from "../../src/core/events";
import { addLink } from "../../src/core/links";
import { searchRecords } from "../../src/core/search";
import { addSeatRecord } from "../../src/core/seat-records";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const search = (input: unknown) => searchRecords(db(), input);

async function seed() {
  await addTransactions(
    db(),
    {
      transactions: [
        { date: "2026-08-02", amount: 1900, merchant: "ダミーシネマ", category: "娯楽", memo: "映画" },
        { date: "2026-09-20", amount: 3200, merchant: "ダミー皮膚科クリニック", category: "その他" },
        { date: "2026-10-03", amount: 1500, merchant: "ダミーシネマ", category: "娯楽" },
        { date: "2026-10-04", amount: 800, merchant: "ダミー薬局", category: "その他", items: [{ name: "皮膚科の処方薬", amount: 800 }] },
      ],
    },
    { now: NOW },
  );
  await addEvent(db(), { start_date: "2026-09-13", end_date: "2026-09-14", title: "ダミー高原キャンプ", note: "家族で", color: "green" }, { now: NOW });
  await addLink(db(), { url: "https://example.com/movie", title: "映画の公式ページ", description: "上映館の案内", date: "2026-10-03" }, { now: NOW });
}

beforeEach(seed);

describe("searchRecords", () => {
  it("新しい日付の順に、種類をまたいで返す。latest_date は最新", async () => {
    const r = await search({ q: "映画" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hits.map((h) => [h.type, h.date])).toEqual([
      ["link", "2026-10-03"],
      ["transaction", "2026-08-02"],
    ]);
    expect(r.latest_date).toBe("2026-10-03");
    expect(r.total).toBe(2);
  });

  it("取引は店名・メモ・カテゴリ・明細の名前で当たる", async () => {
    const byMerchant = await search({ q: "シネマ" });
    expect(byMerchant.ok && byMerchant.hits.map((h) => h.date)).toEqual(["2026-10-03", "2026-08-02"]);
    const byItem = await search({ q: "処方薬" });
    expect(byItem.ok && byItem.hits).toMatchObject([{ type: "transaction", date: "2026-10-04", amount: 800 }]);
    const byCategory = await search({ q: "その他", types: ["transaction"] });
    expect(byCategory.ok && byCategory.total).toBe(2);
  });

  it("皮膚科に最後に行った日: 店名と明細の両方から、新しい順", async () => {
    const r = await search({ q: "皮膚科" });
    expect(r.ok && r.latest_date).toBe("2026-10-04");
    expect(r.ok && r.hits.map((h) => h.date)).toEqual(["2026-10-04", "2026-09-20"]);
  });

  it("出来事は開始日で出て、期間とメモが detail に入る", async () => {
    const r = await search({ q: "キャンプ" });
    expect(r.ok && r.hits).toMatchObject([{ type: "event", date: "2026-09-13", title: "ダミー高原キャンプ", detail: "2026-09-13〜2026-09-14 家族で" }]);
  });

  it("空白区切りは AND。期間・種類で絞れる", async () => {
    expect((await search({ q: "シネマ 映画" })).ok && (await search({ q: "シネマ 映画" }) as { total: number }).total).toBe(1);
    const range = await search({ q: "シネマ", from: "2026-09-01" });
    expect(range.ok && range.total).toBe(1);
    const onlyLinks = await search({ q: "映画", types: ["link"] });
    expect(onlyLinks.ok && onlyLinks.hits.map((h) => h.type)).toEqual(["link"]);
  });

  it("座席の記録は題名・会場で当たる", async () => {
    await addSeatRecord(db(), { date: "2026-07-01", title: "ダミー作品", venue: "ダミー劇場", seat: "F-10" }, { now: NOW });
    const r = await search({ q: "ダミー作品" });
    expect(r.ok && r.hits).toMatchObject([{ type: "seat_record", date: "2026-07-01", title: "ダミー作品" }]);
    expect((await search({ q: "ダミー劇場" })).ok).toBe(true);
  });

  it("% と _ は文字として扱い、該当なしは total 0", async () => {
    const r = await search({ q: "100%_" });
    expect(r.ok && r.total).toBe(0);
    expect(r.ok && r.latest_date).toBeNull();
  });

  it("入力エラー: 空の q・語が多すぎる・from > to・limit", async () => {
    expect((await search({ q: "  " })).ok).toBe(false);
    expect((await search({ q: "a b c d e f" })).ok).toBe(false);
    expect((await search({ q: "a", from: "2026-10-02", to: "2026-10-01" })).ok).toBe(false);
    expect((await search({ q: "a", limit: 101 })).ok).toBe(false);
    expect((await search({ q: "a", extra: 1 })).ok).toBe(false);
  });

  it("limit で件数を絞っても total は全件", async () => {
    const r = await search({ q: "ダミー", limit: 2 });
    expect(r.ok && r.count).toBe(2);
    expect(r.ok && r.total).toBeGreaterThan(2);
  });

  it("表記ゆれ: 全角半角・英字の大文字小文字・ひらがなカタカナを区別しない", async () => {
    await addEvent(db(), { start_date: "2026-06-01", title: "ＴＯＨＯシネマズ 新宿", color: "blue" }, { now: NOW });
    await addEvent(db(), { start_date: "2026-06-02", title: "ひらがなのてすと", color: "blue" }, { now: NOW });
    for (const q of ["toho", "ＴＯＨＯ", "ｔｏｈｏ"]) expect((await search({ q, types: ["event"] })).ok && (await search({ q, types: ["event"] }) as { total: number }).total, q).toBe(1);
    const kata = await search({ q: "テスト", types: ["event"] });
    expect(kata.ok && kata.hits.map((h) => h.date)).toEqual(["2026-06-02"]);
    const hira = await search({ q: "しねま", types: ["event"] });
    expect(hira.ok && hira.total).toBe(1);
  });

  it("電話番号は、ハイフンの有無・全角でも当たる", async () => {
    await addTransactions(db(), { transactions: [{ date: "2026-10-05", amount: 500, merchant: "ダミー電話店", category: "その他", merchant_phone: "03-1234-5678" }] }, { now: NOW });
    for (const q of ["03-1234-5678", "0312345678", "０３－１２３４－５６７８"]) {
      const r = await search({ q, types: ["transaction"] });
      expect(r.ok && r.hits.map((h) => h.title), q).toEqual(["ダミー電話店"]);
    }
  });

  it("ページ送り: offset / limit で昔までさかのぼれる。has_more と offset を返す", async () => {
    for (let d = 1; d <= 7; d++) await addEvent(db(), { start_date: `2026-05-0${d}`, title: `ページ検証${d}`, color: "red" }, { now: NOW });
    const first = await search({ q: "ページ検証", limit: 3 });
    expect(first).toMatchObject({ ok: true, total: 7, count: 3, offset: 0, has_more: true });
    expect(first.ok && first.hits.map((h) => h.title)).toEqual(["ページ検証7", "ページ検証6", "ページ検証5"]);
    const last = await search({ q: "ページ検証", limit: 3, offset: 6 });
    expect(last).toMatchObject({ ok: true, total: 7, count: 1, offset: 6, has_more: false });
    expect(last.ok && last.hits[0]!.title).toBe("ページ検証1");
    const beyond = await search({ q: "ページ検証", limit: 3, offset: 30 });
    expect(beyond).toMatchObject({ ok: true, total: 7, count: 0, has_more: false });
    expect((await search({ q: "a", offset: -1 })).ok).toBe(false);
  });
});

