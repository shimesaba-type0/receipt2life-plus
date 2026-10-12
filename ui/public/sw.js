/* global self, caches, fetch, URL */
// Service Worker。アプリの静的ファイル(JS/CSS/アイコン)だけをキャッシュする。
// 認証付きの内容(/api/*、/mcp、/export、/import、/healthz、写真)は、共有キャッシュに入れないので絶対に扱わない。
// 画面(HTML)もキャッシュしない(常にネットワーク=認証を通す)。
// import を使わない単一ファイル(テストは tests/ui/sw.test.ts が、このファイルを読んで判定関数を検証する)。

// 更新のたびに、この版を上げる。古い版のキャッシュは activate で消す
const CACHE_VERSION = "v2";
const CACHE_NAME = `r2l-static-${CACHE_VERSION}`;
const CACHE_PREFIX = "r2l-static-";

// 絶対にキャッシュしないパス(前方一致)。写真は /api/photos 配下なので /api/ で防がれる
const NEVER_CACHE_PREFIXES = ["/api/", "/mcp", "/export", "/import", "/healthz", "/cdn-cgi/"];
// キャッシュしてよいパス(前方一致)。Vite のハッシュ付き成果物とアイコンだけ
const CACHEABLE_PREFIXES = ["/assets/", "/icons/"];

/** このリクエストをキャッシュしてよいか(純関数) */
function isCacheableRequest(method, urlString, origin) {
  if (method !== "GET") return false;
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  const p = url.pathname;
  if (NEVER_CACHE_PREFIXES.some((x) => p.startsWith(x))) return false;
  return CACHEABLE_PREFIXES.some((x) => p.startsWith(x));
}

/** このレスポンスを保存してよいか(認証リダイレクトやエラーを保存しない) */
function isCacheableResponse(res) {
  return res.status === 200 && res.type === "basic" && !res.redirected && !(res.headers.get("cache-control") || "").includes("no-store");
}

// Service Worker の外(テスト)では、イベント登録をしない
if (typeof self !== "undefined" && typeof self.addEventListener === "function" && typeof caches !== "undefined" && typeof self.skipWaiting === "function") {
  self.addEventListener("install", () => {
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)));
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (!isCacheableRequest(req.method, req.url, self.location.origin)) return; // ブラウザに任せる
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (isCacheableResponse(res)) await cache.put(req, res.clone());
        return res;
      })(),
    );
  });
}
