import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

// JSONL の税率・税の内訳。店名・金額はダミー
const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");
const exportText = () => new Response(exportJsonl(db())).text();
const exportRecords = async () => (await exportText()).trimEnd().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const count = async (table: string) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

async function doImport(text: string): Promise<Extract<ImportResponse, { ok: true }>> {
  const res = await importRecords(db(), text, { now: NOW });
  if (!res.ok) throw new Error(`import failed: ${res.error}`);
  return res;
}

async function seed() {
  const res = await addTransactions(
    db(),
    {
      transactions: [
        {
          date: "2026-10-10",
          amount: 1640,
          merchant: "Aストア",
          items: [
            { name: "牛乳", amount: 540, tax_rate: 8, tax_label: "※" },
            { name: "洗剤", amount: 1100, tax_rate: 10 },
          ],
          tax_lines: [
            { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included" },
            { rate: 0.5, tax_amount: 3, label: "★" },
          ],
        },
        { date: "2026-10-09", amount: 300, merchant: "Bマート" },
      ],
    },
    { now: NOW },
  );
  if (!res.ok) throw new Error("seed failed");
  return res.registered;
}

const T = "2026-10-10T00:00:00.000Z";

describe("JSONL の税率・税の内訳", () => {
  it("取引の行に tax_lines(入れ子。id なし・税率の高い順。なしは [])、明細の行に tax_rate / tax_label を出す", async () => {
    const [t1] = await seed();
    const records = await exportRecords();
    const tx = records.find((r) => r.id === t1!.id)!;
    expect(tx.tax_lines).toEqual([
      { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included", label: null },
      { rate: 0.5, taxable_amount: null, tax_amount: 3, amount_basis: null, label: "★" },
    ]);
    expect(records.find((r) => r.type === "transaction" && r.id !== t1!.id)!.tax_lines).toEqual([]);
    const items = records.filter((r) => r.type === "item").sort((a, b) => Number(a.position) - Number(b.position));
    expect(items.map((i) => [i.tax_rate, i.tax_label])).toEqual([
      [8, "※"],
      [10, null],
    ]);
  });

  it("往復(export → 空にする → import)で同じ内容に戻る", async () => {
    await seed();
    const before = await exportText();
    await db().exec("DELETE FROM transaction_tax_lines");
    await db().exec("DELETE FROM transaction_items");
    await db().exec("DELETE FROM transactions");

    const res = await doImport(before);
    expect(res.summary).toEqual({ total: 4, ok: 4, skipped: 0, errors: 0 });
    expect(await exportText()).toBe(before);
    expect(await count("transaction_tax_lines")).toBe(2);

    // 2回目はすべて skipped_exists で、内訳も増えない
    const again = await doImport(before);
    expect(again.summary.skipped).toBe(4);
    expect(await count("transaction_tax_lines")).toBe(2);
  });

  it("旧形式(tax_lines・tax_rate なし)の行も取り込める", async () => {
    const res = await doImport(
      jsonl(
        { type: "transaction", id: "old1", date: "2026-10-10", amount: 300, merchant: "Cショップ", created_at: T },
        { type: "item", id: "oi1", transaction_id: "old1", position: 0, name: "パン", amount: 300, created_at: T },
      ),
    );
    expect(res.summary).toEqual({ total: 2, ok: 2, skipped: 0, errors: 0 });
    const item = await db().prepare("SELECT tax_rate, tax_label FROM transaction_items WHERE id = 'oi1'").first();
    expect(item).toEqual({ tax_rate: null, tax_label: null });
    expect(await count("transaction_tax_lines")).toBe(0);
  });

  it("不正な tax_lines(税率の重複・範囲外)の取引は、その取引と明細の行がエラー", async () => {
    const res = await doImport(
      jsonl(
        { type: "transaction", id: "b1", date: "2026-10-10", amount: 300, merchant: "Dマート", created_at: T, tax_lines: [{ rate: 8 }, { rate: 8 }] },
        { type: "item", id: "bi1", transaction_id: "b1", position: 0, name: "パン", amount: 300 },
        { type: "transaction", id: "b2", date: "2026-10-10", amount: 300, merchant: "Eマート", created_at: T, tax_lines: [{ rate: 200 }] },
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "error"]);
    expect(res.results[0]!.message).toContain("税率 8% の行が2つあります");
    expect(await count("transactions")).toBe(0);
  });
});
