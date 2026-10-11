import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CATEGORY_ICON_KEYS } from "../../src/core/category-icons";
import { addCategory, listCategories } from "../../src/core/categories";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// 0007(カテゴリのアイコン)は追加のみ。既存のデータがあるDBに当たり、名前が一致する初期カテゴリにだけ既定のアイコンを付ける
describe("migration 0007_category_icons", () => {
  it("既存のカテゴリ・取引があるDBに当たる。名前を変えた行は触らない", async () => {
    const e = testEnv();
    // 0007 を当てる前の状態に戻す(icon 列とマイグレーションの記録を消す)
    await e.DB.exec("ALTER TABLE categories DROP COLUMN icon");
    await e.DB.prepare("DELETE FROM d1_migrations WHERE name = ?").bind("0007_category_icons.sql").run();
    // 利用者が名前を変えた・足したカテゴリと、それを使う取引
    await e.DB.exec("UPDATE categories SET name = '外食・食材' WHERE id = 'cat_food'");
    await e.DB.exec("INSERT INTO categories (id, name, group_name) VALUES ('cat_user', '推し活', '趣味')");
    await e.DB.prepare(
      `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at)
       VALUES ('old1', '2026-10-01', 1000, 'Aストア', 'cat_user', NULL, NULL, 'manual', 'ok', 'h', ?, ?)`,
    )
      .bind(NOW.toISOString(), NOW.toISOString())
      .run();
    const before = await e.DB.prepare("SELECT * FROM transactions").all();

    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

    const icons = Object.fromEntries((await listCategories(e.DB)).categories.map((c) => [c.name, c.icon]));
    expect(icons).toEqual({
      "外食・食材": null, // 名前が変わっているので触らない
      日用品: "daily",
      "交通・チャージ": "transit",
      娯楽: "entertainment",
      その他: "other",
      推し活: null,
    });
    // 既定のアイコンはすべて一覧にあるキー
    for (const v of Object.values(icons)) if (v) expect(CATEGORY_ICON_KEYS).toContain(v);
    expect((await e.DB.prepare("SELECT * FROM transactions").all()).results).toEqual(before.results);
    expect((await listCategories(e.DB)).categories.find((c) => c.name === "推し活")!.usage).toBe(1);

    // 新しいカテゴリにアイコンを付けられ、取引の登録も今までどおり
    expect((await addCategory(e.DB, { name: "映画館", group_name: "娯楽", icon: "movie" })).ok).toBe(true);
    expect((await addTransactions(e.DB, { transactions: [{ date: "2026-10-03", amount: 300, merchant: "B", category: "映画館" }] }, { now: NOW })).ok).toBe(true);
  });
});
