import { describe, expect, it } from "vitest";
import { summarizeTax } from "../../src/core/tax-summary";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// 税率別の税額の集計。店名・金額はダミー
const db = () => testEnv().DB;

async function seed() {
  const res = await addTransactions(
    db(),
    {
      transactions: [
        // 9月: 10% と 8%(税込)
        {
          date: "2026-09-30",
          amount: 1640,
          merchant: "Aストア",
          items: [
            { name: "牛乳", amount: 540, tax_rate: 8 },
            { name: "洗剤", amount: 1100, tax_rate: 10 },
          ],
          tax_lines: [
            { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included" },
            { rate: 8, taxable_amount: 540, tax_amount: 40, amount_basis: "included", label: "※" },
          ],
        },
        // 10月: 10%(税抜)と 8%(税額の印字なし)
        {
          date: "2026-10-01",
          amount: 1188,
          merchant: "Bマート",
          tax_lines: [
            { rate: 10, taxable_amount: 1000, tax_amount: 100, amount_basis: "excluded" },
            { rate: 8.0, taxable_amount: 80 },
          ],
        },
        // 10月: 小数の税率
        { date: "2026-10-02", amount: 201, merchant: "Cショップ", tax_lines: [{ rate: 0.5, taxable_amount: 200, tax_amount: 1 }] },
        // 10月: 税の内訳なし(明細の税率だけ。税額は計算しない)
        { date: "2026-10-03", amount: 500, merchant: "Dベーカリー", items: [{ name: "パン", amount: 500, tax_rate: 8 }] },
        // 10月: 内訳なし
        { date: "2026-10-04", amount: 700, merchant: "E食堂" },
      ],
    },
    { now: NOW },
  );
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
}

describe("summarizeTax", () => {
  it("税率別(既定): 印字された税額と対象金額だけを足し、件数・混在・欠けを出す", async () => {
    await seed();
    const res = await summarizeTax(db(), {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.group_by).toBe("rate");
    expect(res.rows).toEqual([
      {
        rate: 10,
        tax_total: 200,
        taxable_total: 2100,
        receipt_count: 2,
        missing_tax_amount: 0,
        taxable_basis: { included_total: 1100, excluded_total: 1000, unknown_total: 0 },
        mixed_basis: true,
      },
      {
        rate: 8,
        tax_total: 40,
        taxable_total: 620,
        receipt_count: 2,
        missing_tax_amount: 1,
        taxable_basis: { included_total: 540, excluded_total: 0, unknown_total: 80 },
        mixed_basis: true,
      },
      {
        rate: 0.5,
        tax_total: 1,
        taxable_total: 200,
        receipt_count: 1,
        missing_tax_amount: 0,
        taxable_basis: { included_total: 0, excluded_total: 0, unknown_total: 200 },
        mixed_basis: false,
      },
    ]);
    expect(res.totals).toEqual({
      tax_total: 241,
      taxable_total: 2920,
      receipt_count: 3,
      taxable_basis: { included_total: 1640, excluded_total: 1000, unknown_total: 280 },
      mixed_basis: true,
    });
    // カバレッジ: 内訳の無い取引(明細の税率だけのものも含む)は件数と金額で出す
    expect(res.coverage).toEqual({
      transactions: { count: 5, total: 4229 },
      with_tax_lines: { count: 3, total: 3029 },
      without_tax_lines: { count: 2, total: 1200 },
      lines_missing_tax_amount: 1,
      lines_missing_taxable_amount: 0,
    });
    expect(res.message).toContain("税額の合計 241円");
    expect(res.message).toContain("税の内訳が記録されていない支出が2件(1,200円)");
  });

  it("月別: 月の古い順 → 税率の高い順。期間で絞れる", async () => {
    await seed();
    const res = await summarizeTax(db(), { group_by: "month" });
    expect(res.ok && res.rows.map((r) => [r.month, r.rate, r.tax_total])).toEqual([
      ["2026-09", 10, 100],
      ["2026-09", 8, 40],
      ["2026-10", 10, 100],
      ["2026-10", 8, 0],
      ["2026-10", 0.5, 1],
    ]);

    const oct = await summarizeTax(db(), { from: "2026-10-01", to: "2026-10-31" });
    expect(oct.ok && oct.rows.map((r) => [r.rate, r.tax_total, r.receipt_count])).toEqual([
      [10, 100, 1],
      [8, 0, 1],
      [0.5, 1, 1],
    ]);
    expect(oct.ok && oct.coverage.without_tax_lines).toEqual({ count: 2, total: 1200 });
    expect(oct.ok && oct.rows[0]!.month).toBeUndefined();
  });

  it("空の期間・内訳の無い期間", async () => {
    const empty = await summarizeTax(db(), { from: "2026-01-01", to: "2026-01-31" });
    expect(empty).toMatchObject({
      ok: true,
      rows: [],
      totals: { tax_total: 0, taxable_total: 0, receipt_count: 0, mixed_basis: false },
      coverage: { transactions: { count: 0, total: 0 }, without_tax_lines: { count: 0, total: 0 } },
    });
    expect(empty.ok && empty.message).toContain("記録された支出はありません");

    await seed();
    const none = await summarizeTax(db(), { from: "2026-10-03", to: "2026-10-04" });
    expect(none).toMatchObject({ ok: true, rows: [], coverage: { without_tax_lines: { count: 2, total: 1200 } } });
    expect(none.ok && none.message).toContain("税の内訳(tax_lines)が記録された支出はありません");
  });

  it("from が to より後・未知の group_by はエラー", async () => {
    expect(await summarizeTax(db(), { from: "2026-10-02", to: "2026-10-01" })).toMatchObject({ ok: false, errors: [{ field: "from" }] });
    expect(await summarizeTax(db(), { group_by: "category" })).toMatchObject({ ok: false });
  });
});
