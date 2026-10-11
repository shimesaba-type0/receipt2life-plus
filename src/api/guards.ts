import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

const UNSAFE = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const deny = (status: 403 | 415 | 404, field: string, message: string) =>
  Response.json({ ok: false, errors: [{ field, message }] }, { status });

// CSRF 対策: 状態を変えるメソッドは、同一オリジンからのものだけ受ける
// Origin があればリクエスト先と同じか検査し、無ければ Sec-Fetch-Site が same-origin / none のものだけ通す
// (どちらも無い=curl などの非ブラウザは通す。ブラウザは必ずどちらかを付ける)
export const sameOriginOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE.has(c.req.method)) {
    const origin = c.req.header("origin");
    const site = c.req.header("sec-fetch-site");
    const forbidden = origin !== undefined ? origin !== new URL(c.req.url).origin : site !== undefined && site !== "same-origin" && site !== "none";
    if (forbidden) return deny(403, "origin", "origin: 別のサイトからのリクエストは受け付けません");
  }
  await next();
};

// JSON を受けるルート用: Content-Type が application/json でなければ 415
export const requireJson: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method === "POST" || c.req.method === "PATCH") {
    const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") return deny(415, "content-type", "content-type: application/json で送ってください");
  }
  await next();
};

// JSON の API 応答はキャッシュさせない(写真の配信は別に指定する)
export const noStoreJson: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if ((c.res.headers.get("content-type") ?? "").includes("application/json")) {
    c.res.headers.set("cache-control", "private, no-store");
  }
};

// 長すぎる id は、中身を見ずに404にする(メッセージに長い入力を載せない)
export const shortIdOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if ((c.req.param("id") ?? "").length > 64) return deny(404, "id", "id: その id のものはありません");
  await next();
};
