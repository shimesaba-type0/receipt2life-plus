import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import type { TestEnv } from "./helpers";

beforeEach(async () => {
  const e = env as unknown as TestEnv;
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
  // 外部キーの順(子から先に)で、データを空にする。
  await e.DB.exec("DELETE FROM seat_records");
  await e.DB.exec("DELETE FROM screens");
  await e.DB.exec("DELETE FROM venues");
  await e.DB.exec("DELETE FROM links");
  await e.DB.exec("DELETE FROM attachments");
  await e.DB.exec("DELETE FROM transaction_items");
  await e.DB.exec("DELETE FROM events");
  await e.DB.exec("DELETE FROM transactions");
  // カテゴリは、テストで増減・改名するので初期データに戻す
  await e.DB.exec("DELETE FROM categories");
  await e.DB.exec(
    "INSERT INTO categories (id, name, group_name, icon) VALUES ('cat_food','食費','食費','food'),('cat_daily','日用品','生活','daily'),('cat_transport','交通・チャージ','交通','transit'),('cat_leisure','娯楽','娯楽','entertainment'),('cat_other','その他','その他','other')",
  );
  // 口座も、テストで増減・改名するので初期データに戻す(取引を消したあとなので外部キーに触れない)
  await e.DB.exec("DELETE FROM accounts");
  await e.DB.exec("INSERT INTO accounts (id, name) VALUES ('acc_cash','現金'),('acc_card','カード'),('acc_suica','Suica')");
  // 写真の実体(R2)も空にする
  const { objects } = await e.PHOTOS.list();
  if (objects.length > 0) await e.PHOTOS.delete(objects.map((o) => o.key));
});
