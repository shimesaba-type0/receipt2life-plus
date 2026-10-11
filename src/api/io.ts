import type { Hono } from "hono";
import type { AppEnv } from "../env";

// エクスポート(GET /export)とインポート(POST /import)のルート。実装は src/io に置く
export function registerIoRoutes(app: Hono<AppEnv>): void {
  void app;
}
