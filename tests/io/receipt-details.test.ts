import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

// JSONL(エクスポート・インポート)とレシートの情報。電話・住所・番号はダミー
const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");
const exportText = async () => new Response(exportJsonl(db())).text();
const parse = (text: string) => text.trimEnd().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const rowOf = async (id: string) => db().prepare("SELECT * FROM transactions WHERE id = ?").bind(id).first<Record<string, unknown>>();

const DETAILS = {
  paid_time: "14:32",
  merchant_phone: "03-0000-0000",
  merchant_address: "東京都〇〇区〇〇1-2-3",
  invoice_number: "T0000000000000",
  clerk_name: "山田",
  receipt_no: "R-100",
};

describe("JSONL とレシートの情報", () => {
  it("エクスポートの取引の行に6項目を含める(なしは null)", async () => {
    await addTransactions(
      db(),
      {
        transactions: [
          { date: "2026-10-01", amount: 1000, merchant: "Aタクシー", ...DETAILS },
          { date: "2026-10-02", amount: 2000, merchant: "B店" },
        ],
      },
      { now: NOW },
    );
    const rows = parse(await exportText()).filter((r) => r.type === "transaction");
    expect(rows.find((r) => r.merchant === "Aタクシー")).toMatchObject(DETAILS);
    expect(rows.find((r) => r.merchant === "B店")).toMatchObject({
      paid_time: null,
      merchant_phone: null,
      merchant_address: null,
      invoice_number: null,
      clerk_name: null,
      receipt_no: null,
    });
  });

  it("export → 全削除 → import で、6項目も dedup_hash も戻る(同じ日・同じ店・同額で時刻違いの2件も残る)", async () => {
    await addTransactions(
      db(),
      {
        transactions: [
          { date: "2026-10-01", amount: 1000, merchant: "Aタクシー", ...DETAILS },
          { date: "2026-10-01", amount: 1000, merchant: "Aタクシー", paid_time: "18:05" },
          { date: "2026-10-02", amount: 2000, merchant: "B店" },
        ],
      },
      { now: NOW },
    );
    const before = (await db().prepare("SELECT * FROM transactions ORDER BY id").all()).results;
    const text = await exportText();
    await db().exec("DELETE FROM transactions");

    const res = await importRecords(db(), text, { now: NOW });
    expect(res.ok && res.summary).toEqual({ total: 3, ok: 3, skipped: 0, errors: 0 });
    const after = (await db().prepare("SELECT * FROM transactions ORDER BY id").all()).results;
    expect(after).toEqual(before);
  });

  it("同じバックアップを2回戻しても増えない", async () => {
    await addTransactions(db(), { transactions: [{ date: "2026-10-01", amount: 1000, merchant: "Aタクシー", ...DETAILS }] }, { now: NOW });
    const text = await exportText();
    const res = await importRecords(db(), text, { now: NOW });
    expect(res.ok && res.summary).toMatchObject({ ok: 0, skipped: 1, errors: 0 });
  });

  it("古いバックアップ(6項目なし)も取り込める。項目は null になる", async () => {
    const res = await importRecords(
      db(),
      jsonl({
        type: "transaction",
        id: "old1",
        date: "2026-09-01",
        amount: 800,
        merchant: "旧店",
        category: "食費",
        account: "現金",
        memo: null,
        source: "receipt",
        status: "ok",
        tax_flag: null,
        created_at: "2026-09-01T03:00:00.000Z",
        updated_at: "2026-09-01T03:00:00.000Z",
      }),
      { now: NOW },
    );
    expect(res.ok && res.summary).toMatchObject({ ok: 1, errors: 0 });
    expect(await rowOf("old1")).toMatchObject({ paid_time: null, merchant_phone: null, merchant_address: null, invoice_number: null, clerk_name: null, receipt_no: null });
  });

  it("手書きの行でも値を正規化し、不正な値はその行だけエラー", async () => {
    const res = await importRecords(
      db(),
      jsonl(
        { type: "transaction", date: "2026-10-01", amount: 500, merchant: "C店", paid_time: "09:15", invoice_number: "t 0000-0000-00000", merchant_phone: "０３−００００−００００" },
        { type: "transaction", date: "2026-10-01", amount: 600, merchant: "D店", invoice_number: "T12" },
        { type: "transaction", date: "2026-10-01", amount: 700, merchant: "E店", paid_time: "24:00" },
      ),
      { now: NOW },
    );
    expect(res.ok && res.results.map((r) => r.status)).toEqual(["ok", "error", "error"]);
    expect(res.ok && res.results[1]!.message).toContain("T と数字13桁で入力してください");
    const c = await db().prepare("SELECT * FROM transactions WHERE merchant = 'C店'").first<Record<string, unknown>>();
    expect(c).toMatchObject({ paid_time: "09:15", invoice_number: "T0000000000000", merchant_phone: "03-0000-0000" });
  });

  it("手書きの行の重複判定: 時刻が違えば取り込み、同じなら重複としてスキップ", async () => {
    await addTransactions(db(), { transactions: [{ date: "2026-10-01", amount: 1000, merchant: "Aタクシー", paid_time: "08:10" }] }, { now: NOW });
    const res = await importRecords(
      db(),
      jsonl(
        { type: "transaction", date: "2026-10-01", amount: 1000, merchant: "Aタクシー", paid_time: "18:05" },
        { type: "transaction", date: "2026-10-01", amount: 1000, merchant: "Aタクシー", paid_time: "08:10" },
        { type: "transaction", date: "2026-10-01", amount: 1000, merchant: "Aタクシー" },
      ),
      { now: NOW },
    );
    expect(res.ok && res.results.map((r) => r.status)).toEqual(["ok", "skipped_duplicate", "ok"]);
  });
});
