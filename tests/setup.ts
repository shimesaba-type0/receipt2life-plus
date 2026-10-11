import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import type { TestEnv } from "./helpers";

beforeEach(async () => {
  const e = env as unknown as TestEnv;
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
  await e.DB.exec("DELETE FROM transactions");
});
