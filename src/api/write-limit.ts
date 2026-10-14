import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

// 書き込みの回数の制限(暴走・無限ループよけ)。時間あたりの回数を数えて、超えたら 429 で止める。
// 数えるのは、このWorkerのインスタンス(isolate)の中だけ(最良努力)。インスタンスが入れ替わると数え直しになる。
// 1人用で、リクエストは同じインスタンスに集まりやすいので、AI のループのような短時間の連続には効く。
// 確実な上限が要るなら、Cloudflare の Rate Limiting(設定が必要)を足す。D1 には書かない(制限のための書き込みで、書き込みを増やさない)

export interface WriteLimitConfig {
  limit: number;
  windowMs: number;
}

// 画面・API の書き込み(POST / PATCH / PUT / DELETE)と、MCP(POST。ツールの読み書きを区別せず1回と数える)
export const DEFAULT_API_WRITE_LIMIT: WriteLimitConfig = { limit: 120, windowMs: 60_000 };
export const DEFAULT_MCP_LIMIT: WriteLimitConfig = { limit: 240, windowMs: 60_000 };

export type TakeResult = { ok: true } | { ok: false; retryAfterSec: number };

// 直近 windowMs の間の回数を数える(スライディングウィンドウ)。保持するのは、時刻を最大 limit 個だけ
export function createWindowLimiter(config: WriteLimitConfig, now: () => number = Date.now) {
  const hits: number[] = [];
  return {
    take(): TakeResult {
      const t = now();
      while (hits.length > 0 && t - hits[0]! >= config.windowMs) hits.shift();
      if (hits.length >= config.limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((hits[0]! + config.windowMs - t) / 1000)) };
      }
      hits.push(t);
      return { ok: true };
    },
  };
}

const UNSAFE = new Set(["POST", "PATCH", "PUT", "DELETE"]);

type Limiter = ReturnType<typeof createWindowLimiter>;

// 制限を超えたら 429。ログは、1分に1回だけ(パスの値は載せない)
export function writeLimit(limiter: Limiter, label: string, applies: (method: string) => boolean = (m) => UNSAFE.has(m)): MiddlewareHandler<AppEnv> {
  let lastLog = 0;
  return async (c, next) => {
    if (!applies(c.req.method)) return next();
    const r = limiter.take();
    if (r.ok) return next();
    const t = Date.now();
    if (t - lastLog >= 60_000) {
      lastLog = t;
      console.log(`write limit: ${label} ${c.req.method} が短時間に多すぎるため止めました`);
    }
    return c.json(
      { ok: false, errors: [{ field: "rate_limit", message: `短時間に書き込みが多すぎるため、止めました(暴走・ループよけ)。${r.retryAfterSec}秒ほど待ってから、もう一度お試しください` }] },
      429,
      { "retry-after": String(r.retryAfterSec) },
    );
  };
}
