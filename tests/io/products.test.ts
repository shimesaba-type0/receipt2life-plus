import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

// JSONL の商品の情報(商品名・買った数・内容量・単位)。店名・金額はダミー
const db = () => testEnv().DB;
const exportRecords = async () => (await new Response(exportJsonl(db())).text()).trimEnd().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
async function doImport(text: string): Promise<Extract<ImportResponse, { ok: true }>> {
  const res = await importRecords(db(), text, { now: NOW });
  if (!res.ok) throw new Error(`import failed: ${res.error}`);
  return res;
}

describe("商品の情報のバックアップ", () => {
  it("明細の行に出て、往復で同じ内容に戻る(商品の情報が消えない)", async () => {
    await addTransactions(
      db(),
      { transactions: [{ date: "2026-10-10", amount: 448, merchant: "Aストア", items: [{ name: "牛乳 1L", amount: 198, product: "牛乳", quantity: 1, content_amount: 1000, content_unit: "ml", jan_code: "4901234567894" }, { name: "卵 10個", amount: 250, product: "卵", content_amount: 10, content_unit: "個" }] }] },
      { now: NOW },
    );
    const before = await exportRecords();
    const items = before.filter((r) => r.type === "item");
    const byName = (name: string) => items.find((r) => r.name === name);
    expect(byName("牛乳 1L")).toMatchObject({ name: "牛乳 1L", product: "牛乳", quantity: 1, content_amount: 1000, content_unit: "ml", jan_code: "4901234567894" });
    expect(byName("卵 10個")).toMatchObject({ product: "卵", content_amount: 10, content_unit: "個" });
    await db().exec("DELETE FROM transaction_items");
    await db().exec("DELETE FROM transactions");
    const restored = await doImport(before.map((r) => JSON.stringify(r)).join("\n"));
    expect(restored.summary).toMatchObject({ errors: 0 });
    expect(await exportRecords()).toEqual(before);
  });

  it("取り込み: 内容量と単位が片方だけ・不正な単位の行は、その行だけエラー", async () => {
    const tx = { type: "transaction", id: "t1", date: "2026-10-10", amount: 100, merchant: "Aストア" };
    const text = [tx, { type: "item", transaction_id: "t1", name: "a", amount: 100, content_amount: 10 }, { type: "item", transaction_id: "t1", name: "b", amount: 100, content_amount: 10, content_unit: "kg" }, { type: "item", transaction_id: "t1", name: "c", amount: 100, product: "牛乳", content_amount: 1000, content_unit: "ml" }]
      .map((r) => JSON.stringify(r))
      .join("\n");
    const res = await doImport(text);
    expect(res.results.filter((r) => r.status === "error")).toHaveLength(2);
    expect(res.results.filter((r) => r.status === "ok")).toHaveLength(2);
  });

  it("取り込み: JANコードの検査桁が合わない行は、その行だけエラー", async () => {
    const tx = { type: "transaction", id: "t1", date: "2026-10-10", amount: 100, merchant: "Aストア" };
    const res = await doImport([tx, { type: "item", transaction_id: "t1", name: "a", amount: 100, jan_code: "4901234567895" }, { type: "item", transaction_id: "t1", name: "b", amount: 100, jan_code: "4901234567894" }].map((r) => JSON.stringify(r)).join("\n"));
    expect(res.results.filter((r) => r.status === "error")).toHaveLength(1);
  });
});

