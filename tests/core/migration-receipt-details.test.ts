import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDay } from "../../src/core/calendar";
import { listTransactions } from "../../src/core/transactions";
import { testEnv } from "../helpers";

// 0006(レシートの情報)は追加のみ。既存の取引があるDBに当てても、既存のデータは変わらない
describe("migration 0006_receipt_details", () => {
  it("既存の取引があるDBに当たり、既存の行を変えない(新しい列は NULL のまま)", async () => {
    const e = testEnv();
    // 0006 を当てる前の状態に戻す
    for (const col of ["paid_time", "merchant_phone", "merchant_address", "invoice_number", "clerk_name", "receipt_no"]) {
      await e.DB.exec(`ALTER TABLE transactions DROP COLUMN ${col}`);
    }
    await e.DB.prepare("DELETE FROM d1_migrations WHERE name = ?").bind("0006_receipt_details.sql").run();

    const insert = (id: string, date: string, amount: number, merchant: string, createdAt: string) =>
      e.DB.prepare(
        `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag)
         VALUES (?, ?, ?, ?, 'cat_food', NULL, NULL, 'manual', 'ok', 'h', ?, ?, NULL)`,
      )
        .bind(id, date, amount, merchant, createdAt, createdAt)
        .run();
    await insert("old1", "2026-10-01", 1000, "Aストア", "2026-10-01T01:00:00.000Z");
    await insert("old2", "2026-10-01", 500, "Bストア", "2026-10-01T02:00:00.000Z");
    const before = await e.DB.prepare("SELECT * FROM transactions ORDER BY id").all();

    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

    const after = await e.DB.prepare("SELECT * FROM transactions ORDER BY id").all();
    expect(after.results).toEqual(before.results.map((r) => ({ ...r, paid_time: null, merchant_phone: null, merchant_address: null, invoice_number: null, clerk_name: null, receipt_no: null })));

    // 既存の取引は、新しい項目が null のまま一覧に出る。日の並びは登録順(時刻なしどうし)のまま
    const list = await listTransactions(e.DB, {});
    expect(list.ok && list.transactions.every((t) => t.paid_time === null && t.invoice_number === null)).toBe(true);
    const day = await getDay(e.DB, "2026-10-01");
    expect(day.ok && day.transactions.map((t) => t.id)).toEqual(["old1", "old2"]);
  });
});
