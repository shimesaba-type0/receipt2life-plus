import { describe, expect, it } from "vitest";
import { summarizeDeductions } from "../../src/core/deductions";
import { addCategory } from "../../src/core/categories";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

async function seed() {
  const cat = await addCategory(db(), { name: "通院の交通", group_name: "交通" });
  if (!cat.ok) throw new Error(JSON.stringify(cat.errors));
  const res = await addTransactions(
    db(),
    {
      transactions: [
        { date: "2026-10-01", amount: 3000, merchant: "ダミー病院", category: "その他", tax_flag: "medical" },
        { date: "2026-10-01", amount: 800, merchant: "ダミー病院の駐車場", category: "通院の交通", tax_flag: "medical" },
        { date: "2026-10-02", amount: 1200, merchant: "ダミー薬局", category: "その他", tax_flag: "self_medication" },
        { date: "2026-10-03", amount: 500, merchant: "フラグなし", category: "食費" },
        { date: "2026-09-20", amount: 700, merchant: "範囲外", category: "その他", tax_flag: "medical" },
        {
          date: "2026-10-04",
          amount: 1500,
          merchant: "ダミー薬局2",
          category: "その他",
          items: [
            { name: "薬A", amount: 1000, tax_flag: "self_medication" },
            { name: "日用品", amount: 500, tax_flag: null },
          ],
        },
      ],
    },
    { now: NOW },
  );
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
}

describe("summarizeDeductions", () => {
  it("セルフメディケーションと医療費(交通費を含む・含まない)を、期間内のフラグ付きの支出だけで合計する", async () => {
    await seed();
    const r = await summarizeDeductions(db(), { from: "2026-10-01", to: "2026-10-31" });
    if (!r.ok) throw new Error("deductions");
    // 明細の行ごとの実効フラグ: 1200 + 1000(明細)
    expect(r.self_medication).toEqual({ total: 2200, count: 2 });
    expect(r.medical.including_transport).toEqual({ total: 3800, count: 2 });
    expect(r.medical.transport).toEqual({ total: 800, count: 1 });
    expect(r.medical.excluding_transport).toEqual({ total: 3000, count: 1 });
    expect(r.transport_group).toBe("交通");
  });

  it("期間を省略すると全期間", async () => {
    await seed();
    const r = await summarizeDeductions(db(), {});
    if (!r.ok) throw new Error("deductions");
    expect(r.medical.including_transport.total).toBe(4500);
  });

  it("記録が無ければ0", async () => {
    const r = await summarizeDeductions(db(), { from: "2030-01-01", to: "2030-12-31" });
    expect(r).toMatchObject({ ok: true, self_medication: { total: 0, count: 0 }, medical: { including_transport: { total: 0, count: 0 } } });
  });

  it("不正な期間はエラー", async () => {
    expect((await summarizeDeductions(db(), { from: "2026-10-05", to: "2026-10-01" })).ok).toBe(false);
    expect((await summarizeDeductions(db(), { from: "x" })).ok).toBe(false);
    expect((await summarizeDeductions(db(), { year: 2026 })).ok).toBe(false);
  });
});
