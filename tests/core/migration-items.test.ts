import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { summarize } from "../../src/core/summarize";
import { addTransactions, listTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// 0005(明細)は追加のみ。既存の取引があるDBに当てても、既存のデータは変わらない
describe("migration 0005_transaction_items", () => {
  it("既存の取引があるDBに当たり、既存の行・集計を変えない(バックフィルしない)", async () => {
    const e = testEnv();
    // 0005 を当てる前の状態に戻す(テーブルとマイグレーションの記録を消す)
    await e.DB.exec("DROP TABLE transaction_items");
    await e.DB.prepare("DELETE FROM d1_migrations WHERE name = ?").bind("0005_transaction_items.sql").run();

    // 0004 までのスキーマで、既存の取引を入れる(明細のテーブルが無いので、直接 INSERT する)
    const insert = (id: string, date: string, amount: number, merchant: string | null, category: string | null, flag: string | null) =>
      e.DB.prepare(
        `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, 'manual', ?, 'h', ?, ?, ?)`,
      )
        .bind(id, date, amount, merchant, category, merchant && category ? "ok" : "needs_review", NOW.toISOString(), NOW.toISOString(), flag)
        .run();
    await insert("old1", "2026-10-01", 1000, "Aストア", "cat_food", null);
    await insert("old2", "2026-10-02", 500, null, null, "medical");
    const before = await e.DB.prepare("SELECT * FROM transactions ORDER BY id").all();

    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

    const after = await e.DB.prepare("SELECT * FROM transactions ORDER BY id").all();
    expect(after.results).toEqual(before.results);
    expect((await e.DB.prepare("SELECT COUNT(*) AS n FROM transaction_items").first<{ n: number }>())!.n).toBe(0);

    // 既存の取引は明細なし(空配列)の1行として、今までどおり集計される
    const list = await listTransactions(e.DB, {});
    expect(list.ok && list.transactions.map((t) => [t.id, t.items])).toEqual([
      ["old2", []],
      ["old1", []],
    ]);
    const sum = await summarize(e.DB, { group_by: "category" });
    expect(sum).toMatchObject({ ok: true, total: 1500, count: 2, lines: 2 });

    // 新しい取引には明細を付けられる
    const added = await addTransactions(
      e.DB,
      { transactions: [{ date: "2026-10-03", amount: 300, merchant: "Bマート", category: "食費", items: [{ name: "A", amount: 300 }] }] },
      { now: NOW },
    );
    expect(added.ok).toBe(true);
  });
});
