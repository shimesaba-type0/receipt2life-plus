import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { listTransactions } from "../../src/core/transactions";
import { testEnv } from "../helpers";

// 0013(レジ番号・店番号)は追加のみ。既存の取引があるDBに当てても、既存のデータは変わらない
describe("migration 0013_register_store", () => {
  it("既存の取引があるDBに当たり、既存の行を変えない(新しい列は NULL のまま)", async () => {
    const e = testEnv();
    for (const col of ["register_no", "store_code"]) await e.DB.exec(`ALTER TABLE transactions DROP COLUMN ${col}`);
    await e.DB.prepare("DELETE FROM d1_migrations WHERE name = ?").bind("0013_register_store.sql").run();
    await e.DB.prepare(
      `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag)
       VALUES ('old1', '2026-10-01', 1000, 'Aストア', 'cat_food', NULL, NULL, 'manual', 'ok', 'h', '2026-10-01T01:00:00.000Z', '2026-10-01T01:00:00.000Z', NULL)`,
    ).run();
    const before = await e.DB.prepare("SELECT * FROM transactions").all();

    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

    const after = await e.DB.prepare("SELECT * FROM transactions").all();
    expect(after.results).toEqual(before.results.map((r) => ({ ...r, register_no: null, store_code: null })));
    const list = await listTransactions(e.DB, {});
    expect(list.ok && list.transactions[0]).toMatchObject({ register_no: null, store_code: null });
  });
});
