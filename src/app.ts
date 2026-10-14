import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { accessAuth, type KeyResolver } from "./auth/access";
import { routePath } from "hono/route";
import type { AppEnv } from "./env";
import { registerIoRoutes } from "./api/io";
import { sameOriginOnly } from "./api/guards";
import { registerApiRoutes } from "./api/routes";
import { createMcpServer } from "./mcp/server";
import type { TitleFetcher } from "./core/link-titles";
import { createWindowLimiter, DEFAULT_API_WRITE_LIMIT, DEFAULT_MCP_LIMIT, writeLimit, type WriteLimitConfig } from "./api/write-limit";

// これ以上かかった /api/* は、ログに残す(ダッシュボードの Observability で、どのルートが遅いか見るため)
const SLOW_API_MS = 300;

export interface AppOptions {
  // リンクのタイトルを取りに行く関数(本番だけ渡す。省略するとタイトルは取りに行かない。テストで外へ出ないように)
  fetchTitle?: TitleFetcher;
  // 使用量のグラフを取りに行く fetch(本番だけ渡す。省略すると、設定があっても取得しない。テストで外へ出ないように)
  usageFetch?: typeof fetch;
  // 書き込み回数の制限(省略すると既定。テストで小さくして試す)
  writeLimits?: { api?: WriteLimitConfig; mcp?: WriteLimitConfig };
  // テスト用: JWTの鍵の取得を差し替える
  getKey?: KeyResolver;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  // すべてのルートを認証の内側に置く(存在しないパスも、未認証なら401)
  app.use("*", accessAuth(options.getKey ? { getKey: options.getKey } : {}));

  app.get("/healthz", (c) => c.json({ ok: true }));

  // 書き込みの回数の制限(暴走・ループよけ。インスタンスごとの最良努力)。画面・API・インポートは同じ枠、MCP は別の枠
  const apiLimiter = createWindowLimiter(options.writeLimits?.api ?? DEFAULT_API_WRITE_LIMIT);
  app.use("/api/*", writeLimit(apiLimiter, "api"));
  app.use("/import", writeLimit(apiLimiter, "import"));
  app.use("/mcp", writeLimit(createWindowLimiter(options.writeLimits?.mcp ?? DEFAULT_MCP_LIMIT), "mcp", (m) => m === "POST"));

  // 画面からの書き込み(インポート)は、同一オリジンのものだけ受ける
  app.use("/import", sameOriginOnly);
  registerIoRoutes(app);

  // MCP(Streamable HTTP、ステートレス): リクエストごとにサーバーとトランスポートを作る
  app.all("/mcp", async (c) => {
    const server = createMcpServer(c.env.DB, c.env.PHOTOS, new URL(c.req.url).origin, options.fetchTitle);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // /api/* の応答時間を測る。Server-Timing(ブラウザの開発者ツールで見える)と、遅いときだけログ(原因調査用)
  app.use("/api/*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    c.res.headers.set("server-timing", `app;dur=${ms}`);
    // パスの値(日付・id)は載せず、ルートの形だけを記録する
    if (ms >= SLOW_API_MS) console.log(`slow api: ${c.req.method} ${routePath(c, -1)} ${c.res.status} ${ms}ms`);
  });

  registerApiRoutes(app, { fetchTitle: options.fetchTitle, usageFetch: options.usageFetch });
  // 未定義の /api/* は、画面(SPA)ではなく404のJSONにする
  app.all("/api/*", (c) => c.json({ ok: false, errors: [{ field: "path", message: "そのAPIはありません" }] }, 404));

  // それ以外は、Web UI の静的ファイル。認証の内側で配信する(run_worker_first = true)
  app.all("*", async (c) => {
    if (!c.env.ASSETS) return c.text("Not Found", 404);
    return c.env.ASSETS.fetch(c.req.raw);
  });

  // 想定外の例外は、ログに種類と文面だけ残し(値は出さない)、/api/* にはJSONで返す
  app.onError((err, c) => {
    const name = err instanceof Error ? err.name : "Error";
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    console.error(`error: ${name}: ${reason}`);
    if (new URL(c.req.url).pathname.startsWith("/api/")) {
      return c.json({ ok: false, errors: [{ field: "server", message: `サーバーでエラーが起きました(${reason})` }] }, 500);
    }
    return c.text("Internal Server Error", 500);
  });

  return app;
}
