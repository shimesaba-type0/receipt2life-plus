import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { accessAuth, type KeyResolver } from "./auth/access";
import type { AppEnv } from "./env";
import { registerIoRoutes } from "./api/io";
import { createMcpServer } from "./mcp/server";

export interface AppOptions {
  // テスト用: JWTの鍵の取得を差し替える
  getKey?: KeyResolver;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  // すべてのルートを認証の内側に置く(存在しないパスも、未認証なら401)
  app.use("*", accessAuth(options.getKey ? { getKey: options.getKey } : {}));

  app.get("/healthz", (c) => c.json({ ok: true }));

  registerIoRoutes(app);

  // MCP(Streamable HTTP、ステートレス): リクエストごとにサーバーとトランスポートを作る
  app.all("/mcp", async (c) => {
    const server = createMcpServer(c.env.DB);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
