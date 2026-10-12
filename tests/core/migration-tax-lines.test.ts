import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { listTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// 0012(税率・税の内訳)は追加のみ。既存の取引・明細があるDBに当てても、既存のデータは変わらない
describe("migration 0012_tax_lines", () => {
  it("既存の明細の行を変えず(新しい列は NULL)、内訳のテーブルと制約を作る", async () => {
    const e = testEnv();
    // 0012 を当てる前の状態に戻す
    await e.DB.exec("DROP TABLE transaction_tax_lines");
    for (const col of ["tax_rate", "tax_label"]) await e.DB.exec(`ALTER TABLE transaction_items DROP COLUMN ${col}`);
    await e.DB.prepare("DELETE FROM d1_migrations WHERE name = ?").bind("0012_tax_lines.sql").run();

    const ts = NOW.toISOString();
    await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO transactions (id, date, amount, merchant, category_id, source, status, dedup_hash, created_at, updated_at)
         VALUES ('old1', '2026-10-01', 300, 'Aストア', 'cat_food', 'manual', 'ok', 'h', ?, ?)`,
      ).bind(ts, ts),
      e.DB.prepare(
        `INSERT INTO transaction_items (id, transaction_id, position, name, amount, category_id, tax_flag, memo, created_at)
         VALUES ('i1', 'old1', 0, 'パン', 300, NULL, NULL, NULL, ?)`,
      ).bind(ts),
    ]);
    const before = await e.DB.prepare("SELECT * FROM transaction_items ORDER BY id").all();

    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

    const after = await e.DB.prepare("SELECT * FROM transaction_items ORDER BY id").all();
    expect(after.results).toEqual(before.results.map((r) => ({ ...r, tax_rate: null, tax_label: null })));
    const list = await listTransactions(e.DB, {});
    expect(list.ok && list.transactions[0]!.tax_lines).toEqual([]);

    // 制約: 税率の範囲、amount_basis の値、(取引, 税率) の一意、取引の削除で消える
    const insertLine = (id: string, rate: number, basis: string | null = null) =>
      e.DB.prepare("INSERT INTO transaction_tax_lines (id, transaction_id, rate, amount_basis, created_at) VALUES (?, 'old1', ?, ?, ?)").bind(id, rate, basis, ts).run();
    await insertLine("l1", 8);
    await expect(insertLine("l2", 8.0)).rejects.toThrow();
    await expect(insertLine("l3", 101)).rejects.toThrow();
    await expect(insertLine("l4", 10, "gross")).rejects.toThrow();
    await expect(e.DB.prepare("UPDATE transaction_items SET tax_rate = -1 WHERE id = 'i1'").run()).rejects.toThrow();
    const index = await e.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transaction_tax_lines' AND name = 'idx_transaction_tax_lines_transaction'").first();
    expect(index).not.toBeNull();
  });
});
