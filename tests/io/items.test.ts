import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

// 明細(type: "item")の JSONL。店名・品名はダミー
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

const T = "2026-10-10T00:00:00.000Z";
const tx = (over: Record<string, unknown> = {}) => ({ type: "transaction", id: "tx1", date: "2026-10-10", amount: 1000, merchant: "Aストア", category: "食費", created_at: T, ...over });
const item = (over: Record<string, unknown> = {}) => ({ type: "item", id: "it1", transaction_id: "tx1", position: 0, name: "牛乳", amount: 1000, ...over });

async function seedWithItems() {
  const res = await addTransactions(
    db(),
    {
      transactions: [
        {
          date: "2026-10-10",
          amount: 1030,
          merchant: "Aストア",
          category: "食費",
          items: [
            { name: "牛乳", amount: 250 },
            { name: "洗剤", amount: 830, category: "日用品", tax_flag: "medical", memo: "メモ" },
            { name: "値引", amount: -50 },
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

describe("JSONL の明細", () => {
  it("取引の後に item の行を出す(カテゴリは名前、行自身の値)", async () => {
    const [t1] = await seedWithItems();
    const records = await exportRecords();
    expect(records.map((r) => r.type)).toEqual(["transaction", "transaction", "item", "item", "item"]);
    const items = records.filter((r) => r.type === "item").sort((a, b) => Number(a.position) - Number(b.position));
    expect(items[1]).toEqual({
      type: "item",
      id: t1!.items[1]!.id,
      transaction_id: t1!.id,
      position: 1,
      name: "洗剤",
      amount: 830,
      category: "日用品",
      tax_flag: "medical",
      memo: "メモ",
      tax_rate: null,
      tax_label: null,
      created_at: NOW.toISOString(),
    });
    expect(items[0]).toMatchObject({ category: null, tax_flag: null });
  });

  it("往復(export → 空にする → import)で同じ内容に戻る。2回目はすべて skipped_exists", async () => {
    await seedWithItems();
    const before = await exportText();
    await db().exec("DELETE FROM transaction_items");
    await db().exec("DELETE FROM transactions");

    const res = await doImport(before);
    expect(res.summary).toEqual({ total: 5, ok: 5, skipped: 0, errors: 0 });
    expect(res.results.map((r) => r.type)).toEqual(["transaction", "transaction", "item", "item", "item"]);
    expect(await exportText()).toBe(before);

    const again = await doImport(before);
    expect(again.summary).toEqual({ total: 5, ok: 0, skipped: 5, errors: 0 });
    expect(again.results.every((r) => r.status === "skipped_exists")).toBe(true);
    expect(await count("transaction_items")).toBe(3);
  });

  it("合計が合わない取引は、取引と明細の行がエラーになり、何も入らない(他の取引は取り込む)", async () => {
    const res = await doImport(
      jsonl(
        tx(),
        item({ amount: 600 }),
        item({ id: "it2", position: 1, name: "パン", amount: 300 }),
        tx({ id: "tx2", amount: 500, merchant: "Bマート" }),
        item({ id: "it3", transaction_id: "tx2", amount: 500 }),
      ),
    );
    expect(res.results.map((r) => [r.line, r.status])).toEqual([
      [1, "error"],
      [2, "error"],
      [3, "error"],
      [4, "ok"],
      [5, "ok"],
    ]);
    expect(res.results[0]!.message).toContain("差額は100円");
    expect(res.results[1]!.message).toContain("1行目");
    expect(await count("transactions")).toBe(1);
    expect(await count("transaction_items")).toBe(1);
  });

  it("並びは position、明細の status は行のカテゴリから決める。値引き行も取り込む", async () => {
    const res = await doImport(
      jsonl(
        tx({ category: null }),
        item({ id: "b", position: 1, name: "割引", amount: -100, category: "食費" }),
        item({ id: "a", position: 0, name: "肉", amount: 1100, category: "食費" }),
      ),
    );
    expect(res.summary.ok).toBe(3);
    const rows = await db().prepare("SELECT id, position FROM transaction_items ORDER BY position").all();
    expect(rows.results).toEqual([
      { id: "a", position: 0 },
      { id: "b", position: 1 },
    ]);
    const t = await db().prepare("SELECT status FROM transactions WHERE id = 'tx1'").first();
    expect(t).toEqual({ status: "ok" });
  });

  it("取引の行が無い明細はエラー。取引の行に items を書いたらエラー", async () => {
    const res = await doImport(jsonl(item({ transaction_id: "nothing" }), { ...tx({ id: "tx9" }), items: [{ name: "A", amount: 1000 }] }));
    expect(res.results.map((r) => r.status)).toEqual(["error", "error"]);
    expect(res.results[0]!.message).toContain("取引の行がこのファイルにありません");
    expect(res.results[1]!.message).toContain('type が "item" の行');
  });

  it("重複としてスキップした取引の明細は skipped_duplicate。明細の行の検証エラーはその行だけ", async () => {
    await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 1000, merchant: "Aストア", category: "食費" }] }, { now: NOW });
    // id と created_at が無い行は、従来どおり重複判定をする
    const res = await doImport(
      jsonl(
        { type: "transaction", id: "tx5", date: "2026-10-10", amount: 1000, merchant: "Aストア" },
        item({ transaction_id: "tx5" }),
        item({ id: "bad", transaction_id: "tx5", amount: 0 }),
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["skipped_duplicate", "skipped_duplicate", "error"]);
  });

  it("古いバックアップ(明細なし)は今までどおり取り込める", async () => {
    const res = await doImport(jsonl(tx(), tx({ id: "tx2", date: "2026-10-09", amount: 200, merchant: "Bマート" })));
    expect(res.summary).toEqual({ total: 2, ok: 2, skipped: 0, errors: 0 });
    expect(await count("transaction_items")).toBe(0);
  });

  it("復元で、取り込み先に無い明細のカテゴリを自動で作る(バックアップ行のみ)", async () => {
    const res = await doImport(jsonl(tx(), item({ category: "旅先の雑貨" })));
    expect(res.summary.ok).toBe(2);
    const cat = await db().prepare("SELECT group_name FROM categories WHERE name = '旅先の雑貨'").first();
    expect(cat).toEqual({ group_name: "その他" });
  });
});
