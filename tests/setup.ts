import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import type { TestEnv } from "./helpers";

beforeEach(async () => {
  const e = env as unknown as TestEnv;
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
  // 外部キーの順(子から先に)で、データを空にする。カテゴリと口座の初期データは残す
  await e.DB.exec("DELETE FROM attachments");
  await e.DB.exec("DELETE FROM events");
  await e.DB.exec("DELETE FROM transactions");
  // 写真の実体(R2)も空にする
  const { objects } = await e.PHOTOS.list();
  if (objects.length > 0) await e.PHOTOS.delete(objects.map((o) => o.key));
});
