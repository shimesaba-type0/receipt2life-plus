import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

// JSONL と register_no / store_code。値はダミー
const db = () => testEnv().DB;
const exportText = async () => new Response(exportJsonl(db())).text();

describe("JSONL のレジ番号・店番号", () => {
  it("エクスポートに含め、export → 全削除 → import で戻る", async () => {
    await addTransactions(db(), { transactions: [{ date: "2026-10-01", amount: 1000, merchant: "Aストア", register_no: "0005", store_code: "007832" }, { date: "2026-10-02", amount: 2000, merchant: "B店" }] }, { now: NOW });
    const before = (await db().prepare("SELECT * FROM transactions ORDER BY id").all()).results;
    const text = await exportText();
    const rows = text.trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>).filter((r) => r.type === "transaction");
    expect(rows.find((r) => r.merchant === "Aストア")).toMatchObject({ register_no: "0005", store_code: "007832" });
    expect(rows.find((r) => r.merchant === "B店")).toMatchObject({ register_no: null, store_code: null });
    await db().exec("DELETE FROM transactions");
    const res = await importRecords(db(), text, { now: NOW });
    expect(res.ok && res.summary).toMatchObject({ ok: 2, errors: 0 });
    expect((await db().prepare("SELECT * FROM transactions ORDER BY id").all()).results).toEqual(before);
  });

  it("旧形式(2項目なし)も取り込め、null になる。手書きの値は正規化し、不正な行だけエラー", async () => {
    const base = { type: "transaction", date: "2026-09-01", amount: 800, merchant: "旧店", category: "食費", source: "receipt", created_at: "2026-09-01T03:00:00.000Z", updated_at: "2026-09-01T03:00:00.000Z" };
    const text = [
      JSON.stringify({ ...base, id: "old1" }),
      JSON.stringify({ ...base, id: "new1", merchant: "新店", register_no: " 0007 ", store_code: "123" }),
      JSON.stringify({ ...base, id: "bad1", merchant: "不正", store_code: "9".repeat(31) }),
    ].join("\n");
    const res = await importRecords(db(), text, { now: NOW });
    expect(res.ok && res.summary).toMatchObject({ ok: 2, errors: 1 });
    const row = (id: string) => db().prepare("SELECT register_no, store_code FROM transactions WHERE id = ?").bind(id).first();
    expect(await row("old1")).toEqual({ register_no: null, store_code: null });
    expect(await row("new1")).toEqual({ register_no: "0007", store_code: "123" });
  });
});
