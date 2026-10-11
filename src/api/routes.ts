import type { Hono } from "hono";
import type { AppEnv } from "../env";

// Web UI 用のAPI(/api/*)。docs/api.md の契約に沿って、核(core)の関数を呼んで実装する
export function registerApiRoutes(app: Hono<AppEnv>): void {
  void app;
}
