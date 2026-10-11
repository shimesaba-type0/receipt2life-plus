import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const TEAM = "example-team.cloudflareaccess.com";
const AUD = "test-audience-tag";

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let getKey: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  getKey = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
});

function sign(opts: { iss?: string; aud?: string; exp?: string | number; key?: CryptoKey; claims?: Record<string, unknown> } = {}) {
  return new SignJWT({ email: "me@example.com", ...opts.claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

const app = () => createApp({ getKey: () => getKey });
const env = (extra: Record<string, string> = {}): Record<string, unknown> => ({
  DB: testEnv().DB,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ...extra,
});
const call = (token: string | null, e: object = env(), url = "https://app.example.com/healthz") =>
  app().request(url, token ? { headers: { "Cf-Access-Jwt-Assertion": token } } : {}, e);

describe("Cloudflare Access のJWT検証", () => {
  it("正しいJWTなら通る", async () => {
    expect((await call(await sign())).status).toBe(200);
  });

  it("ヘッダーなしは401", async () => {
    expect((await call(null)).status).toBe(401);
  });

  it("期限切れは401", async () => {
    expect((await call(await sign({ exp: Math.floor(Date.now() / 1000) - 60 }))).status).toBe(401);
  });

  it("audience違いは401", async () => {
    expect((await call(await sign({ aud: "other" }))).status).toBe(401);
  });

  it("issuer違いは401", async () => {
    expect((await call(await sign({ iss: "https://evil.cloudflareaccess.com" }))).status).toBe(401);
  });

  it("別の鍵で署名されたJWTは401", async () => {
    expect((await call(await sign({ key: otherPrivateKey }))).status).toBe(401);
  });

  it("emailのないJWT(サービストークン)も通る", async () => {
    const token = await new SignJWT({ common_name: "svc.access" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(privateKey);
    expect((await call(token)).status).toBe(200);
  });

  it("チーム名にhttps://が付いていても動く", async () => {
    expect((await call(await sign(), env({ ACCESS_TEAM_DOMAIN: `https://${TEAM}/` }))).status).toBe(200);
  });
});

describe("フェイルクローズ", () => {
  it("ACCESS_TEAM_DOMAIN が空なら、正しいJWTでも全拒否", async () => {
    expect((await call(await sign(), env({ ACCESS_TEAM_DOMAIN: "" }))).status).toBe(401);
  });

  it("ACCESS_AUD が空なら全拒否", async () => {
    expect((await call(await sign(), env({ ACCESS_AUD: "" }))).status).toBe(401);
  });

  it("設定が未定義でも全拒否", async () => {
    expect((await call(await sign(), { DB: testEnv().DB })).status).toBe(401);
  });

  it("存在しないパスも認証が先(未認証は404ではなく401)", async () => {
    expect((await call(null, env(), "https://app.example.com/nope")).status).toBe(401);
  });
});

describe("ローカルの素通り(AUTH_BYPASS)", () => {
  it("AUTH_BYPASS=1 かつ localhost なら通る", async () => {
    const res = await call(null, env({ AUTH_BYPASS: "1" }), "http://localhost:8787/healthz");
    expect(res.status).toBe(200);
  });

  it("AUTH_BYPASS=1 でも localhost 以外のホストは通らない", async () => {
    const res = await call(null, env({ AUTH_BYPASS: "1" }), "https://app.example.com/healthz");
    expect(res.status).toBe(401);
  });

  it("localhost でも AUTH_BYPASS が無ければ通らない", async () => {
    expect((await call(null, env(), "http://localhost:8787/healthz")).status).toBe(401);
  });

  it("AUTH_BYPASS が 1 以外なら通らない", async () => {
    expect((await call(null, env({ AUTH_BYPASS: "true" }), "http://localhost:8787/healthz")).status).toBe(401);
  });
});
