import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import type { TestEnv } from "./helpers";

beforeEach(async () => {
  const e = env as unknown as TestEnv;
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
  // 外部キーの順(子から先に)で、データを空にする。口座の初期データは残す
  await e.DB.exec("DELETE FROM links");
  await e.DB.exec("DELETE FROM attachments");
  await e.DB.exec("DELETE FROM events");
  await e.DB.exec("DELETE FROM transactions");
  // カテゴリは、テストで増減・改名するので初期データに戻す(口座は変わらない)
  await e.DB.exec("DELETE FROM categories");
  await e.DB.exec(
    "INSERT INTO categories (id, name, group_name) VALUES ('cat_food','食費','食費'),('cat_daily','日用品','生活'),('cat_transport','交通・チャージ','交通'),('cat_leisure','娯楽','娯楽'),('cat_other','その他','その他')",
  );
  // 写真の実体(R2)も空にする
  const { objects } = await e.PHOTOS.list();
  if (objects.length > 0) await e.PHOTOS.delete(objects.map((o) => o.key));
});
