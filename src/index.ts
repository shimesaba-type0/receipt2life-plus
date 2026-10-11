import { Hono } from "hono";

// 認証ミドルウェア(フェイルクローズ)はフェーズ2で入れる
const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

export default app;
