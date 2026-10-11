import type { Context, MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AppEnv } from "../env";
import type { Identity } from "./identity";

const JWT_HEADER = "Cf-Access-Jwt-Assertion";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type KeyResolver = (teamDomain: string) => JWTVerifyGetKey;

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

// 本番: AccessのJWKSを取得してキャッシュする(鍵は定期的にローテーションされる)
const remoteKeys: KeyResolver = (teamDomain) => {
  let keys = remoteKeySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeySets.set(teamDomain, keys);
  }
  return keys;
};

// "https://team.cloudflareaccess.com/" のような入力も "team.cloudflareaccess.com" にそろえる
export function normalizeTeamDomain(value: string | undefined): string | undefined {
  const host = value?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return host ? host : undefined;
}

function isLocalRequest(c: Context<AppEnv>): boolean {
  return LOCAL_HOSTS.has(new URL(c.req.url).hostname);
}

function unauthorized(c: Context<AppEnv>) {
  return c.json({ error: "unauthorized" }, 401);
}

// 弾いた理由を、トークンや値を含めずに説明する(ログ用。レスポンスには出さない)
function describeFailure(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown";
  const e = err as { code?: unknown; claim?: unknown; reason?: unknown; name?: unknown };
  const parts = [e.code, e.claim && `claim=${String(e.claim)}`, e.reason && `reason=${String(e.reason)}`, e.name];
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ") || "unknown";
}

/**
 * Cloudflare Access のJWTを検証する認証ミドルウェア。
 * - 設定(ACCESS_TEAM_DOMAIN / ACCESS_AUD)が空なら、全リクエストを拒否する(フェイルクローズ)
 * - AUTH_BYPASS=1 かつ localhost のときだけ素通り(ローカル開発用)
 */
export function accessAuth(options: { getKey?: KeyResolver } = {}): MiddlewareHandler<AppEnv> {
  const resolveKey = options.getKey ?? remoteKeys;

  return async (c, next) => {
    if (c.env.AUTH_BYPASS === "1" && isLocalRequest(c)) {
      c.set("identity", { id: "local-dev" });
      return next();
    }

    const teamDomain = normalizeTeamDomain(c.env.ACCESS_TEAM_DOMAIN);
    const audience = c.env.ACCESS_AUD?.trim();
    if (!teamDomain || !audience) {
      console.error("auth: ACCESS_TEAM_DOMAIN / ACCESS_AUD が未設定のため、全リクエストを拒否します");
      return unauthorized(c);
    }

    const token = c.req.header(JWT_HEADER);
    if (!token) {
      console.warn("auth: Cf-Access-Jwt-Assertion ヘッダーがありません");
      return unauthorized(c);
    }

    try {
      const { payload } = await jwtVerify(token, resolveKey(teamDomain), {
        issuer: `https://${teamDomain}`,
        audience,
        algorithms: ["RS256"],
      });
      // サービストークンのJWTにはemailが無いことがある。subかcommon_nameで代用する
      const id = payload.sub || (typeof payload.common_name === "string" ? payload.common_name : "unknown");
      const identity: Identity = { id, ...(typeof payload.email === "string" ? { email: payload.email } : {}) };
      c.set("identity", identity);
    } catch (err) {
      console.warn(`auth: JWTの検証に失敗しました (${describeFailure(err)})`);
      return unauthorized(c);
    }
    return next();
  };
}

// 認証済みのリクエストから本人を取り出す
export function getIdentity(c: Context<AppEnv>): Identity {
  return c.get("identity");
}
