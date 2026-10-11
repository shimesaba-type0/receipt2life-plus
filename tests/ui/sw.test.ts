import { describe, expect, it } from "vitest";

// sw.js は import を使わない単一ファイル。読んで評価し、判定関数を取り出す(Service Worker 環境が無いのでイベント登録はされない)
import code from "../../ui/public/sw.js?raw";
const sandbox = new Function(`${code}\nreturn { isCacheableRequest, isCacheableResponse, CACHE_NAME };`)() as Record<string, unknown>;
const isReq = sandbox.isCacheableRequest as (m: string, u: string, o: string) => boolean;
const isRes = sandbox.isCacheableResponse as (r: unknown) => boolean;

const O = "https://app.example.com";

describe("sw: リクエストのキャッシュ判定", () => {
  it("アプリの静的ファイル(JS/CSS/アイコン)はキャッシュする", () => {
    expect(isReq("GET", `${O}/assets/index-abc123.js`, O)).toBe(true);
    expect(isReq("GET", `${O}/assets/index-abc123.css`, O)).toBe(true);
    expect(isReq("GET", `${O}/icons/icon-192.png`, O)).toBe(true);
  });

  it("API・MCP・export・import・healthz・写真は、キャッシュしない", () => {
    for (const p of ["/api/transactions", "/api/photos/abc", "/mcp", "/export", "/export/csv", "/import", "/healthz", "/cdn-cgi/access/login"]) {
      expect(isReq("GET", `${O}${p}`, O)).toBe(false);
    }
  });

  it("画面(HTML)・manifest・sw.js 自身もキャッシュしない", () => {
    for (const p of ["/", "/calendar", "/manifest.webmanifest", "/sw.js"]) expect(isReq("GET", `${O}${p}`, O)).toBe(false);
  });

  it("/assets/ 配下でも、GET 以外・別オリジン・不正なURLはキャッシュしない", () => {
    expect(isReq("POST", `${O}/assets/a.js`, O)).toBe(false);
    expect(isReq("GET", "https://fonts.gstatic.com/assets/a.woff2", O)).toBe(false);
    expect(isReq("GET", "not a url", O)).toBe(false);
  });

  it("パスの偽装(/assets/../api/)は URL 正規化後の /api/ として扱う", () => {
    expect(isReq("GET", `${O}/assets/../api/transactions`, O)).toBe(false);
  });
});

describe("sw: レスポンスの保存判定", () => {
  const res = (init: { status?: number; type?: string; redirected?: boolean; cc?: string }) => ({
    status: init.status ?? 200,
    type: init.type ?? "basic",
    redirected: init.redirected ?? false,
    headers: new Headers(init.cc ? { "cache-control": init.cc } : {}),
  });

  it("通常の200だけ保存する", () => {
    expect(isRes(res({}))).toBe(true);
  });

  it("エラー・リダイレクト(認証画面)・opaque・no-store は保存しない", () => {
    expect(isRes(res({ status: 404 }))).toBe(false);
    expect(isRes(res({ redirected: true }))).toBe(false);
    expect(isRes(res({ type: "opaque" }))).toBe(false);
    expect(isRes(res({ cc: "private, no-store" }))).toBe(false);
  });
});

describe("sw: 版つきキャッシュ名", () => {
  it("キャッシュ名に版が入っている", () => {
    expect(String(sandbox.CACHE_NAME)).toMatch(/^r2l-static-v\d+$/);
  });
});
