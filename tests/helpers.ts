import { env } from "cloudflare:workers";
import type { D1Migration } from "@cloudflare/vitest-plugin";

export interface TestEnv {
  DB: D1Database;
  PHOTOS: R2Bucket;
  TEST_MIGRATIONS: D1Migration[];
}

export function testEnv(): TestEnv {
  return env as unknown as TestEnv;
}

// テスト用の固定の「今」(JSTでは 2026-10-11 12:00)
export const NOW = new Date("2026-10-11T03:00:00Z");
