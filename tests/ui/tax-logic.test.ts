import { describe, expect, it } from "vitest";
import type { TaxSummaryData, TaxSummaryRow } from "../../src/api/contract";
import * as core from "../../src/core/tax-lines";
import {
  MAX_TAX_LABEL,
  MAX_TAX_LINES,
  MAX_TAX_RATE,
  RATE_OTHER,
  buildTaxLines,
  coverageNote,
  deductionRows,
  transportNote,
  emptyTaxLineRow,
  formatRate,
  groupRowsByMonth,
  itemRateLabel,
  parseRate,
  periodRange,
  rateFields,
  rateFromFields,
  taxLineRowsFromView,
  taxSummaryQuery,
  type TaxLineRow,
} from "../../ui/src/pages/taxLogic";
import { buildItems, buildPatch, emptyItemRow, emptyTxForm, isBlankRow, itemRowsFromView } from "../../ui/src/pages/transactionLogic";

const line = (p: Partial<TaxLineRow>): TaxLineRow => ({ ...emptyTaxLineRow("k"), ...p });

describe("税率の入力", () => {
  it("上限はサーバー(core)と同じ", () => {
    expect([MAX_TAX_RATE, MAX_TAX_LABEL, MAX_TAX_LINES]).toEqual([core.MAX_TAX_RATE, core.MAX_TAX_LABEL, core.MAX_TAX_LINES]);
  });

  it("parseRate: 印字どおりの数字。全角・末尾の%可、小数第3位まで、0〜100。空は null", () => {
    expect(parseRate("10")).toEqual({ ok: true, value: 10 });
    expect(parseRate("８%")).toEqual({ ok: true, value: 8 });
    expect(parseRate("8.0")).toEqual({ ok: true, value: 8 });
    expect(parseRate(" 0.5 ")).toEqual({ ok: true, value: 0.5 });
    expect(parseRate("0")).toEqual({ ok: true, value: 0 });
    expect(parseRate("")).toEqual({ ok: true, value: null });
    for (const bad of ["101", "-1", "8.0001", "abc", "1e2"]) expect(parseRate(bad).ok, bad).toBe(false);
    // サーバーの検証とも一致する
    for (const s of ["10", "0.5", "8.125", "100"]) expect(core.taxRateField.safeParse(Number(s)).success).toBe(true);
    expect(core.taxRateField.safeParse(8.0001).success).toBe(false);
  });

  it("選択肢に無い既存の値は「その他」に入って表示・保存できる", () => {
    expect(rateFields(null)).toEqual({ rate_choice: "", rate_other: "" });
    expect(rateFields(8)).toEqual({ rate_choice: "8", rate_other: "" });
    expect(rateFields(1)).toEqual({ rate_choice: RATE_OTHER, rate_other: "1" });
    expect(rateFields(0.5)).toEqual({ rate_choice: RATE_OTHER, rate_other: "0.5" });
    expect(rateFromFields(rateFields(1))).toEqual({ ok: true, value: 1 });
    expect(rateFromFields({ rate_choice: RATE_OTHER, rate_other: "" })).toEqual({ ok: true, value: null });
  });

  it("表示: 8% ※ のように添える", () => {
    expect(formatRate(0.5)).toBe("0.5%");
    expect(itemRateLabel({ tax_rate: 8, tax_label: "※" })).toBe("8% ※");
    expect(itemRateLabel({ tax_rate: null, tax_label: "軽" })).toBe("軽");
    expect(itemRateLabel({ tax_rate: null, tax_label: null })).toBeNull();
  });
});

describe("明細の行の税率", () => {
  it("行の税率・記号をフォームにし、API の入力に戻す", () => {
    const rows = itemRowsFromView([{ id: "a", position: 0, name: "牛乳", amount: 250, category: null, tax_flag: null, memo: null, tax_rate: 1, tax_label: "★", product: null, quantity: null, content_amount: null, content_unit: null, unit_price: null }]);
    expect(rows[0]).toMatchObject({ rate_choice: RATE_OTHER, rate_other: "1", tax_label: "★" });
    expect(buildItems(rows)).toEqual({ ok: true, value: [{ name: "牛乳", amount: 250, category: null, tax_flag: null, memo: null, tax_rate: 1, tax_label: "★", product: null, quantity: null, content_amount: null, content_unit: null }] });
  });
  it("税率だけ入れた行は空行ではない(品名が要る)。不正な税率・長い記号はエラー", () => {
    expect(isBlankRow({ ...emptyItemRow("x"), rate_choice: "8" })).toBe(false);
    expect(buildItems([{ ...emptyItemRow("x"), rate_choice: "8" }])).toMatchObject({ ok: false, error: "1行目: 品名を入力してください。" });
    expect(buildItems([{ ...emptyItemRow("x"), name: "a", amount: "1", rate_choice: RATE_OTHER, rate_other: "120" }])).toMatchObject({ ok: false });
    expect(buildItems([{ ...emptyItemRow("x"), name: "a", amount: "1", tax_label: "あ".repeat(21) }])).toMatchObject({ ok: false });
  });
});

describe("税の内訳の編集", () => {
  it("空の行は除き、数字は印字どおり。税込・税抜は選んだときだけ", () => {
    const r = buildTaxLines([
      line({ rate_choice: "10", taxable_amount: "1,100", tax_amount: "100", amount_basis: "included" }),
      emptyTaxLineRow("x"),
      line({ rate_choice: RATE_OTHER, rate_other: "0.5", tax_amount: "3", label: " ★ " }),
    ]);
    expect(r).toEqual({
      ok: true,
      value: [
        { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included", label: null },
        { rate: 0.5, taxable_amount: null, tax_amount: 3, amount_basis: null, label: "★" },
      ],
    });
  });
  it("税率なし・同じ税率・負や小数の金額はエラー(何行目かを出す)", () => {
    expect(buildTaxLines([line({ tax_amount: "100" })])).toMatchObject({ ok: false, error: expect.stringContaining("1行目") });
    expect(buildTaxLines([line({ rate_choice: "8" }), line({ rate_choice: RATE_OTHER, rate_other: "8.0" })])).toMatchObject({ ok: false, error: expect.stringContaining("税率 8% の行") });
    expect(buildTaxLines([line({ rate_choice: "8", tax_amount: "-1" })])).toMatchObject({ ok: false });
    expect(buildTaxLines([line({ rate_choice: "8", taxable_amount: "1.5" })])).toMatchObject({ ok: false });
  });
  it("表示から編集の行に戻す", () => {
    const rows = taxLineRowsFromView([{ id: "l1", rate: 8, taxable_amount: null, tax_amount: 40, amount_basis: "excluded", label: "※" }]);
    expect(rows).toEqual([{ key: "l1", rate_choice: "8", rate_other: "", taxable_amount: "", tax_amount: "40", amount_basis: "excluded", label: "※" }]);
  });
  it("PATCH: 行があれば tax_lines、0行で元々あれば []、なければ省略。tax を渡さなければ送らない", () => {
    const form = { ...emptyTxForm("2026-10-11"), amount: "100" };
    const withLines = buildPatch(form, [], false, { rows: [line({ rate_choice: "10", tax_amount: "9" })], had: false });
    expect(withLines.ok && withLines.value.tax_lines).toEqual([{ rate: 10, taxable_amount: null, tax_amount: 9, amount_basis: null, label: null }]);
    const cleared = buildPatch(form, [], false, { rows: [emptyTaxLineRow("x")], had: true });
    expect(cleared.ok && cleared.value.tax_lines).toEqual([]);
    const none = buildPatch(form, [], false, { rows: [], had: false });
    expect(none.ok && "tax_lines" in none.value).toBe(false);
    const old = buildPatch(form, [], false);
    expect(old.ok && "tax_lines" in old.value).toBe(false);
    const bad = buildPatch(form, [], false, { rows: [line({ tax_amount: "9" })], had: false });
    expect(bad.ok).toBe(false);
  });
});

describe("税額のページ", () => {
  it("期間: 今月・先月・今年・期間指定", () => {
    expect(periodRange("this_month", "2026-10-11")).toEqual({ ok: true, from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("last_month", "2026-01-15")).toEqual({ ok: true, from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("this_year", "2026-10-11")).toEqual({ ok: true, from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("last_year", "2026-10-11")).toEqual({ ok: true, from: "2025-01-01", to: "2025-12-31" });
    expect(periodRange("custom", "2026-10-11", { from: "2026-04-01", to: "2026-09-30" })).toEqual({ ok: true, from: "2026-04-01", to: "2026-09-30" });
    expect(periodRange("custom", "2026-10-11", { from: "2026-10-02", to: "2026-10-01" })).toMatchObject({ ok: false });
    expect(periodRange("custom", "2026-10-11", { from: "", to: "2026-10-01" })).toMatchObject({ ok: false });
  });

  it("クエリ: 税率別は group_by を付けない", () => {
    expect(taxSummaryQuery("2026-10-01", "2026-10-31", "rate")).toBe("from=2026-10-01&to=2026-10-31");
    expect(taxSummaryQuery("2026-10-01", "2026-10-31", "month")).toBe("from=2026-10-01&to=2026-10-31&group_by=month");
  });

  it("カバレッジの注記", () => {
    const cov = (count: number, without: number, total: number): TaxSummaryData["coverage"] => ({
      transactions: { count, total: 9999 },
      with_tax_lines: { count: count - without, total: 9999 - total },
      without_tax_lines: { count: without, total },
      lines_missing_tax_amount: 0,
      lines_missing_taxable_amount: 0,
    });
    expect(coverageNote(cov(5, 2, 1200))).toBe("税額の記録がない支出: 2件(¥1,200)。この表には含まれていません。");
    expect(coverageNote(cov(3, 0, 0))).toBe("この期間の支出は、すべて税額の記録があります。");
    expect(coverageNote(cov(0, 0, 0))).toBe("この期間の支出はありません。");
  });

  it("月別の行を月ごとにまとめる", () => {
    const row = (month: string, rate: number, tax: number): TaxSummaryRow => ({
      month,
      rate,
      tax_total: tax,
      taxable_total: 0,
      receipt_count: 1,
      missing_tax_amount: 0,
      taxable_basis: { included_total: 0, excluded_total: 0, unknown_total: 0 },
      mixed_basis: false,
    });
    const groups = groupRowsByMonth([row("2026-09", 10, 100), row("2026-09", 8, 40), row("2026-10", 10, 50)]);
    expect(groups.map((g) => [g.month, g.rows.length, g.tax_total])).toEqual([
      ["2026-09", 2, 140],
      ["2026-10", 1, 50],
    ]);
  });
});

describe("確定申告の参考", () => {
  const d = {
    from: "2026-01-01",
    to: "2026-12-31",
    self_medication: { total: 2200, count: 2 },
    medical: { including_transport: { total: 3800, count: 2 }, excluding_transport: { total: 3000, count: 1 }, transport: { total: 800, count: 1 } },
    transport_group: "交通",
  };
  it("3行: セルフメディケーション、医療費(交通費を含む)、医療費(交通費を含まず)", () => {
    expect(deductionRows(d).map((r) => [r.label, r.total, r.count])).toEqual([
      ["セルフメディケーション税制", 2200, 2],
      ["医療費(交通費を含む)", 3800, 2],
      ["医療費(交通費を含まず)", 3000, 1],
    ]);
  });
  it("交通費の注記", () => {
    expect(transportNote(d)).toContain("¥800");
    expect(transportNote(d)).toContain("「交通」");
    expect(transportNote({ ...d, medical: { ...d.medical, transport: { total: 0, count: 0 } } })).toContain("この期間はありません");
  });
});
