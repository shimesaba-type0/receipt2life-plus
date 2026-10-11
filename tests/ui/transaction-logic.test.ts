import { describe, expect, it } from "vitest";
import type { ItemView, TransactionView } from "../../src/api/contract";
import {
  applyBulkCategory,
  applyBulkTaxFlag,
  buildItems,
  buildPatch,
  canConfirmDelete,
  canMatchTotal,
  checkTotals,
  dayItemsSub,
  deleteSummary,
  effectiveCategory,
  effectiveTaxFlag,
  emptyItemRow,
  formatSignedYen,
  isNotFoundErrors,
  itemRowsFromView,
  itemsTotal,
  matchTotal,
  parseAmount,
  shouldDeletePhotos,
  txFormFromView,
  viewTotalsLabel,
  type ItemRow,
  type TxFormValues,
} from "../../ui/src/pages/transactionLogic";

const item = (p: Partial<ItemView> & { amount: number }): ItemView => ({ id: "i", position: 0, name: "品", category: null, tax_flag: null, memo: null, ...p });
const tx = (p: Partial<TransactionView> = {}): TransactionView => ({
  id: "t1",
  date: "2026-10-11",
  amount: 300,
  merchant: "ダミー商店",
  category: "食費",
  account: null,
  memo: null,
  source: "manual",
  status: "ok",
  tax_flag: null,
  paid_time: null,
  merchant_phone: null,
  merchant_address: null,
  invoice_number: null,
  clerk_name: null,
  receipt_no: null,
  items: [],
  ...p,
});
const row = (p: Partial<ItemRow>): ItemRow => ({ ...emptyItemRow("k"), ...p });
const form = (p: Partial<TxFormValues> = {}): TxFormValues => ({ date: "2026-10-11", amount: "300", merchant: "ダミー商店", category: "食費", account: "", memo: "", tax_flag: "", ...p });

describe("金額", () => {
  it("parseAmount はマイナス可、カンマ可、小数・空は null", () => {
    expect(parseAmount("1,200")).toBe(1200);
    expect(parseAmount(" -80 ")).toBe(-80);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("1.5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("マイナスは「-¥80」", () => {
    expect(formatSignedYen(-80)).toBe("-¥80");
    expect(formatSignedYen(1200)).toBe("¥1,200");
    expect(formatSignedYen(0)).toBe("¥0");
  });
});

describe("実効値", () => {
  it("行が null なら取引の値、あれば行の値", () => {
    expect(effectiveCategory(item({ amount: 1 }), tx())).toBe("食費");
    expect(effectiveCategory(item({ amount: 1, category: "日用品" }), tx())).toBe("日用品");
    expect(effectiveCategory(item({ amount: 1 }), tx({ category: null }))).toBeNull();
    expect(effectiveTaxFlag(item({ amount: 1 }), tx({ tax_flag: "medical" }))).toBe("medical");
    expect(effectiveTaxFlag(item({ amount: 1, tax_flag: "donation" }), tx({ tax_flag: "medical" }))).toBe("donation");
  });
  it("明細の合計と、見るだけのビューの表示", () => {
    const items = [item({ amount: 380 }), item({ amount: -80 })];
    expect(itemsTotal(items)).toBe(300);
    expect(viewTotalsLabel(tx({ items }))).toEqual({ total: "明細の合計 ¥300", matches: true, note: "レシートの合計と一致" });
    const bad = viewTotalsLabel(tx({ items, amount: 320 }));
    expect(bad.matches).toBe(false);
    expect(bad.note).toContain("-¥20");
  });
});

describe("dayItemsSub", () => {
  it("明細なしは null", () => {
    expect(dayItemsSub(tx())).toBeNull();
  });
  it("N点。実効カテゴリが取引のカテゴリだけなら「ほか」なし", () => {
    expect(dayItemsSub(tx({ items: [item({ amount: 100 }), item({ amount: 200 })] }))).toEqual({ count: "2点", others: null });
  });
  it("取引のカテゴリ以外の種類の数を「ほかN」", () => {
    const items = [item({ amount: 100 }), item({ amount: 100, category: "日用品" }), item({ amount: 100, category: "日用品" }), item({ amount: 100, category: "医療" })];
    expect(dayItemsSub(tx({ items }))).toEqual({ count: "4点", others: "ほか2" });
  });
  it("取引のカテゴリが無く、行にだけある場合", () => {
    expect(dayItemsSub(tx({ category: null, items: [item({ amount: 100, category: "日用品" })] }))).toEqual({ count: "1点", others: "ほか1" });
  });
});

describe("フォームの初期値", () => {
  it("取引と明細(position順)をフォームの文字列にする", () => {
    expect(txFormFromView(tx({ merchant: null, tax_flag: "medical" }))).toEqual({ date: "2026-10-11", amount: "300", merchant: "", category: "食費", account: "", memo: "", tax_flag: "medical" });
    const rows = itemRowsFromView([item({ id: "b", position: 1, name: "B", amount: -10 }), item({ id: "a", position: 0, name: "A", amount: 310, category: "日用品" })]);
    expect(rows.map((r) => [r.key, r.name, r.amount, r.category])).toEqual([
      ["a", "A", "310", "日用品"],
      ["b", "B", "-10", ""],
    ]);
  });
});

describe("checkTotals / 合計に合わせる", () => {
  it("明細なし(空の行だけ)は ok", () => {
    const c = checkTotals([emptyItemRow("x")], "300");
    expect(c.ok).toBe(true);
    expect(c.rowCount).toBe(0);
    expect(c.label).toBe("明細はありません(1行の支出です)");
  });
  it("一致", () => {
    const c = checkTotals([row({ name: "a", amount: "380" }), row({ name: "b", amount: "-80" })], "300");
    expect(c).toMatchObject({ ok: true, itemsTotal: 300, receiptTotal: 300, diff: 0 });
    expect(c.label).toBe("明細の合計 ¥300 / レシートの合計 ¥300(一致)");
  });
  it("不一致は差を出し、保存不可", () => {
    const c = checkTotals([row({ name: "a", amount: "380" }), row({ name: "b", amount: "-80" })], "350");
    expect(c.ok).toBe(false);
    expect(c.diff).toBe(-50);
    expect(c.label).toBe("明細の合計 ¥300 / レシートの合計 ¥350(差 -¥50)");
    expect(canMatchTotal(c)).toBe(true);
  });
  it("読めない金額・0 の行は不可", () => {
    expect(checkTotals([row({ name: "a", amount: "x" })], "0").ok).toBe(false);
    expect(checkTotals([row({ name: "a", amount: "0" })], "0").hasInvalid).toBe(true);
  });
  it("レシートの合計が空でも落ちない", () => {
    const c = checkTotals([row({ name: "a", amount: "100" })], "");
    expect(c.ok).toBe(false);
    expect(c.receiptTotal).toBeNull();
    expect(canMatchTotal(c)).toBe(true);
  });
  it("matchTotal は取引の金額を明細の合計にする(合計が正のときだけ)", () => {
    const rows = [row({ name: "a", amount: "380" }), row({ name: "b", amount: "-80" })];
    expect(matchTotal(form({ amount: "350" }), rows).amount).toBe("300");
    expect(matchTotal(form({ amount: "350" }), [row({ name: "a", amount: "-80" })]).amount).toBe("350");
    expect(matchTotal(form({ amount: "300" }), rows).amount).toBe("300");
  });
});

describe("一括", () => {
  const rows = [row({ key: "1", category: "日用品", tax_flag: "medical" }), row({ key: "2", category: "医療" })];
  it("カテゴリ: 取引のカテゴリにして、全行を空にする", () => {
    const r = applyBulkCategory(form({ category: "食費" }), rows, "交通費");
    expect(r.form.category).toBe("交通費");
    expect(r.rows.map((x) => x.category)).toEqual(["", ""]);
    expect(r.rows[0]?.tax_flag).toBe("medical");
  });
  it("税金フラグも同様", () => {
    const r = applyBulkTaxFlag(form(), rows, "donation");
    expect(r.form.tax_flag).toBe("donation");
    expect(r.rows.map((x) => x.tax_flag)).toEqual(["", ""]);
    expect(r.rows[0]?.category).toBe("日用品");
  });
});

describe("buildItems / buildPatch", () => {
  it("空の行は除き、空の項目は null にする", () => {
    const r = buildItems([row({ name: " 牛乳 ", amount: "200", category: "食費" }), emptyItemRow("x"), row({ name: "値引き", amount: "-50", tax_flag: "medical", memo: " 割 " })]);
    expect(r).toEqual({
      ok: true,
      value: [
        { name: "牛乳", amount: 200, category: "食費", tax_flag: null, memo: null },
        { name: "値引き", amount: -50, category: null, tax_flag: "medical", memo: "割" },
      ],
    });
  });
  it("エラーは何行目かを日本語で出す", () => {
    expect(buildItems([row({ name: "a", amount: "1" }), row({ name: "", amount: "5" })])).toEqual({ ok: false, error: "2行目: 品名を入力してください。" });
    expect(buildItems([row({ name: "a", amount: "" , memo: "m" })])).toMatchObject({ ok: false });
    expect(buildItems([row({ name: "a", amount: "0" })])).toMatchObject({ ok: false });
    expect(buildItems([row({ name: "a", amount: "10000001" })])).toMatchObject({ ok: false });
    expect(buildItems([row({ name: "a".repeat(101), amount: "1" })])).toMatchObject({ ok: false });
  });
  it("明細つき: items を送る", () => {
    const r = buildPatch(form({ amount: "300", category: "", account: "現金" }), [row({ name: "a", amount: "380" }), row({ name: "b", amount: "-80" })], false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ date: "2026-10-11", amount: 300, merchant: "ダミー商店", category: null, account: "現金", memo: null, tax_flag: null });
      expect(r.value.items).toHaveLength(2);
    }
  });
  it("明細が0行: 元々なければ items を省略、元々あれば [] で全消し", () => {
    const none = buildPatch(form(), [emptyItemRow("x")], false);
    expect(none.ok && "items" in none.value).toBe(false);
    const cleared = buildPatch(form(), [], true);
    expect(cleared.ok && cleared.value.items).toEqual([]);
  });
  it("合計が合わない・金額や日付が不正は送らない", () => {
    expect(buildPatch(form({ amount: "999" }), [row({ name: "a", amount: "100" })], false)).toMatchObject({ ok: false });
    expect(buildPatch(form({ amount: "x" }), [], false)).toEqual({ ok: false, error: "金額は整数(円)で入力してください。" });
    expect(buildPatch(form({ date: "" }), [], false)).toMatchObject({ ok: false });
  });
});

describe("削除", () => {
  const counts = { items: 3, photos: 2, links: 1 };
  it("消えるものの文言", () => {
    expect(deleteSummary(counts)).toBe("明細3行・写真2枚・リンク1件");
  });
  it("写真があるときは同意が要る。DELETE に delete_photos を付けるのも同意したときだけ", () => {
    expect(canConfirmDelete(counts, false)).toBe(false);
    expect(canConfirmDelete(counts, true)).toBe(true);
    expect(shouldDeletePhotos(counts, true)).toBe(true);
    const none = { items: 0, photos: 0, links: 0 };
    expect(canConfirmDelete(none, false)).toBe(true);
    expect(shouldDeletePhotos(none, true)).toBe(false);
  });
});

describe("isNotFoundErrors", () => {
  it("id の「はありません」だけ 404 扱い", () => {
    expect(isNotFoundErrors([{ field: "id", message: "id: その id のものはありません" }])).toBe(true);
    expect(isNotFoundErrors([{ field: "items", message: "合計が合いません" }])).toBe(false);
  });
});
