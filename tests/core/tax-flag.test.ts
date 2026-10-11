import { describe, expect, it } from "vitest";
import { getDay } from "../../src/core/calendar";
import { summarize } from "../../src/core/summarize";
import { TAX_FLAG_LABELS, TAX_FLAGS } from "../../src/core/tax-flags";
import { addTransactions, listTransactions, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

async function add(item: Record<string, unknown>) {
  const res = await addTransactions(db(), { transactions: [{ source: "manual", allow_duplicate: true, ...item }] }, { now: NOW });
  if (!res.ok || !res.registered[0]) throw new Error(`seed failed: ${JSON.stringify(res)}`);
  return res.registered[0];
}

describe("TAX_FLAG_LABELS", () => {
  it("3種類すべてに日本語ラベルがある", () => {
    expect([...TAX_FLAGS]).toEqual(["medical", "self_medication", "donation"]);
    expect(TAX_FLAG_LABELS).toEqual({ medical: "医療費控除", self_medication: "セルフメディケーション税制", donation: "寄附金控除" });
  });
});

describe("add_transactions と tax_flag", () => {
  it("tax_flag を保存して、返す取引にも含める", async () => {
    const t = await add({ date: "2026-10-01", amount: 1200, merchant: "A薬局", category: "日用品", tax_flag: "medical" });
    expect(t.tax_flag).toBe("medical");
    const row = await db().prepare("SELECT tax_flag FROM transactions WHERE id = ?").bind(t.id).first<{ tax_flag: string | null }>();
    expect(row?.tax_flag).toBe("medical");
  });

  it("省略と null は、どちらもフラグなし", async () => {
    const a = await add({ date: "2026-10-01", amount: 100, merchant: "A店" });
    const b = await add({ date: "2026-10-01", amount: 200, merchant: "B店", tax_flag: null });
    expect(a.tax_flag).toBeNull();
    expect(b.tax_flag).toBeNull();
  });

  it("未知のフラグは、選べる値を示すエラー", async () => {
    const res = await addTransactions(db(), { transactions: [{ amount: 100, tax_flag: "other" }] }, { now: NOW });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ index: 0, field: "tax_flag" });
    expect(res.errors[0]!.message).toContain("medical");
    expect(res.errors[0]!.message).toContain("self_medication");
    expect(res.errors[0]!.message).toContain("donation");
  });

  it("重複判定に含めない(フラグが違っても同日・同額・同じ店は重複)", async () => {
    await add({ date: "2026-10-01", amount: 500, merchant: "A薬局", tax_flag: "medical", allow_duplicate: false });
    const res = await addTransactions(db(), { transactions: [{ date: "2026-10-01", amount: 500, merchant: "A薬局", tax_flag: "self_medication" }] }, { now: NOW });
    expect(res.ok && res.registered).toEqual([]);
    expect(res.ok && res.skipped_duplicates).toHaveLength(1);
  });
});

describe("update_transaction と tax_flag", () => {
  it("付ける → 別のフラグに変える → null で解除", async () => {
    const t = await add({ date: "2026-10-01", amount: 900, merchant: "A薬局", category: "日用品" });
    const set = await updateTransaction(db(), { id: t.id, tax_flag: "self_medication" }, { now: NOW });
    expect(set.ok && set.transaction.tax_flag).toBe("self_medication");
    const change = await updateTransaction(db(), { id: t.id, tax_flag: "medical" }, { now: NOW });
    expect(change.ok && change.transaction.tax_flag).toBe("medical");
    const clear = await updateTransaction(db(), { id: t.id, tax_flag: null }, { now: NOW });
    expect(clear.ok && clear.transaction.tax_flag).toBeNull();
    const row = await db().prepare("SELECT tax_flag FROM transactions WHERE id = ?").bind(t.id).first<{ tax_flag: string | null }>();
    expect(row?.tax_flag).toBeNull();
  });

  it("tax_flag だけの更新も成立し、ほかの項目と dedup_hash は変わらない", async () => {
    const t = await add({ date: "2026-10-01", amount: 900, merchant: "A薬局", category: "日用品" });
    const before = await db().prepare("SELECT dedup_hash FROM transactions WHERE id = ?").bind(t.id).first<{ dedup_hash: string }>();
    const res = await updateTransaction(db(), { id: t.id, tax_flag: "donation" }, { now: NOW });
    expect(res.ok && res.transaction).toMatchObject({ amount: 900, merchant: "A薬局", status: "ok", tax_flag: "donation" });
    const after = await db().prepare("SELECT dedup_hash FROM transactions WHERE id = ?").bind(t.id).first<{ dedup_hash: string }>();
    expect(after?.dedup_hash).toBe(before?.dedup_hash);
  });

  it("ほかの項目だけの更新では、フラグは変わらない", async () => {
    const t = await add({ date: "2026-10-01", amount: 900, merchant: "A薬局", tax_flag: "medical" });
    const res = await updateTransaction(db(), { id: t.id, memo: "メモ" }, { now: NOW });
    expect(res.ok && res.transaction.tax_flag).toBe("medical");
  });

  it("未知のフラグはエラー", async () => {
    const t = await add({ date: "2026-10-01", amount: 900 });
    const res = await updateTransaction(db(), { id: t.id, tax_flag: "xxx" }, { now: NOW });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.errors[0]?.field).toBe("tax_flag");
  });
});

describe("list_transactions の tax_flag 絞り込み", () => {
  async function seed() {
    await add({ date: "2026-10-01", amount: 100, merchant: "A", tax_flag: "medical" });
    await add({ date: "2026-10-02", amount: 200, merchant: "B", tax_flag: "self_medication" });
    await add({ date: "2026-10-03", amount: 300, merchant: "C", tax_flag: "donation" });
    await add({ date: "2026-10-04", amount: 400, merchant: "D" });
  }

  it("指定したフラグだけを返す", async () => {
    await seed();
    const res = await listTransactions(db(), { tax_flag: "self_medication" });
    expect(res.ok && res.transactions.map((t) => t.merchant)).toEqual(["B"]);
  });

  it('"any" は何かのフラグがあるもの全部', async () => {
    await seed();
    const res = await listTransactions(db(), { tax_flag: "any" });
    expect(res.ok && res.transactions.map((t) => t.merchant)).toEqual(["C", "B", "A"]);
  });

  it("期間と組み合わせられる。省略すると絞り込まない", async () => {
    await seed();
    const ranged = await listTransactions(db(), { tax_flag: "any", from: "2026-10-02", to: "2026-10-02" });
    expect(ranged.ok && ranged.transactions.map((t) => t.merchant)).toEqual(["B"]);
    const all = await listTransactions(db(), {});
    expect(all.ok && all.count).toBe(4);
  });

  it("不正な値はエラー", async () => {
    const res = await listTransactions(db(), { tax_flag: "none" });
    expect(res.ok).toBe(false);
  });

  it("返す取引に tax_flag が含まれる", async () => {
    await seed();
    const res = await listTransactions(db(), {});
    expect(res.ok && res.transactions.find((t) => t.merchant === "A")?.tax_flag).toBe("medical");
    expect(res.ok && res.transactions.find((t) => t.merchant === "D")?.tax_flag).toBeNull();
  });
});

describe("summarize の group_by: tax_flag", () => {
  async function seed() {
    await add({ date: "2025-12-31", amount: 7000, merchant: "前年", tax_flag: "self_medication" });
    await add({ date: "2026-01-10", amount: 3000, merchant: "A", tax_flag: "self_medication" });
    await add({ date: "2026-05-10", amount: 2000, merchant: "B", tax_flag: "self_medication" });
    await add({ date: "2026-06-10", amount: 4000, merchant: "C", tax_flag: "medical" });
    await add({ date: "2026-07-10", amount: 10000, merchant: "D", tax_flag: "donation" });
    await add({ date: "2026-08-10", amount: 1000, merchant: "E" });
  }

  it("行名はラベル、フラグなしは(フラグなし)。金額の降順で、割合つき", async () => {
    await seed();
    const res = await summarize(db(), { group_by: "tax_flag", from: "2026-01-01", to: "2026-12-31" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.total).toBe(20000);
    expect(res.rows).toEqual([
      { key: "donation", label: "寄附金控除", count: 1, total: 10000, percent: 50 },
      { key: "self_medication", label: "セルフメディケーション税制", count: 2, total: 5000, percent: 25 },
      { key: "medical", label: "医療費控除", count: 1, total: 4000, percent: 20 },
      { key: "(フラグなし)", label: "(フラグなし)", count: 1, total: 1000, percent: 5 },
    ]);
  });

  it("2026年のセルフメディケーションの合計が出せる(期間外は含めない)", async () => {
    await seed();
    const res = await summarize(db(), { group_by: "tax_flag", from: "2026-01-01", to: "2026-12-31" });
    const row = res.ok ? res.rows.find((r) => r.key === "self_medication") : undefined;
    expect(row).toMatchObject({ count: 2, total: 5000 });
  });

  it("期間を省略すると全期間", async () => {
    await seed();
    const res = await summarize(db(), { group_by: "tax_flag" });
    expect(res.ok && res.rows.find((r) => r.key === "self_medication")?.total).toBe(12000);
  });

  it("フラグなしだけでも(フラグなし)の行になり、既存の group_by は変わらない", async () => {
    await add({ date: "2026-08-10", amount: 1000, merchant: "E", category: "食費" });
    const res = await summarize(db(), { group_by: "tax_flag" });
    expect(res.ok && res.rows).toEqual([{ key: "(フラグなし)", label: "(フラグなし)", count: 1, total: 1000, percent: 100 }]);
    const byCat = await summarize(db(), { group_by: "category" });
    expect(byCat.ok && byCat.rows.map((r) => r.key)).toEqual(["食費"]);
  });
});

describe("日の詳細", () => {
  it("取引に tax_flag が含まれる", async () => {
    await add({ date: "2026-10-01", amount: 900, merchant: "A薬局", tax_flag: "medical" });
    const day = await getDay(db(), "2026-10-01");
    expect(day.ok && day.transactions[0]?.tax_flag).toBe("medical");
  });
});
