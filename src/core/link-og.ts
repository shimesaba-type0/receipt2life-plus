import { z } from "zod";
import { decodeEntities, MAX_FETCHED_TITLE, TitleFetchError, type PageInfo } from "./link-titles";
import { parseHttpsUrl } from "./urls";

// ウェブのページの OGP(タイトル・説明文・画像のURL)の取得。ページの先頭部分の <meta> と <title> だけを読む。本文は読まず、画像は保存しない(URLだけ)
// 安全のための制限(登録した本人のリンクだが、サーバーが任意のページへ取りに行くため):
//   https だけ(ポート・認証情報つきは不可)。IPアドレス直書き・localhost・内部向けの名前は行かない
//   3秒で打ち切る。最初の256KBまでしか読まない。HTML 以外は読まない
//   リダイレクトは、同じホスト(www. の有無だけ違うものを含む)への https だけ追う(最大3回)。別のホストへは行かない
//   送るのはリクエストだけ(クッキー・認証は付けない)。取れたものは、文字として保存し、画面では文字として出す(HTML としては出さない)

export const MAX_DESCRIPTION = 500;
const MAX_PAGE_BYTES = 256 * 1024;
const TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_URL = 500;

// サムネイル画像のURL(バックアップの取り込み用)。https のみ・500文字まで
export const thumbnailUrlField = z
  .string({ error: "thumbnail_url は文字列で指定してください" })
  .trim()
  .transform((v, ctx) => {
    const u = parseHttpsUrl(v);
    if (u === null || u.length > MAX_IMAGE_URL || isBlockedHost(new URL(u).hostname)) {
      ctx.addIssue({ code: "custom", message: `thumbnail_url は https のURL(${MAX_IMAGE_URL}文字まで。内部向けのホストは不可)で指定してください` });
      return "";
    }
    return u;
  });

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, max: number) => {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("")}…`;
};

// 取りに行かないホスト: IPアドレス直書き、localhost、内部向けの名前(.local / .internal / .localhost / 1語だけの名前)
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "" || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (h.includes(":") || h.startsWith("[")) return true; // IPv6
  if (/^[\d.]+$/.test(h)) return true; // IPv4(数字とドットだけ)
  if (/^0x[0-9a-f]+$/i.test(h) || /^\d+$/.test(h)) return true; // 16進・10進の IP 表記
  return !h.includes("."); // 1語だけの名前(社内の名前など)
}

const sameSite = (a: string, b: string) => a.replace(/^www\./, "") === b.replace(/^www\./, "");

// 解析する範囲と個数の上限(正規表現の処理時間が、入力の長さの2乗に伸びるのを防ぐ。タグ1つは2KBまで、属性名は64文字まで)
const MAX_PARSE_CHARS = 64 * 1024;
const MAX_TAG_CHARS = 2048;
const MAX_META_TAGS = 300;

// <meta> の属性を読む(属性の値は、ダブル・シングルクォートか、クォートなし)
function metaAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]{0,63})\s{0,8}=\s{0,8}(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\s"'>]{1,2000}))/g)) {
    attrs.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** HTML の先頭部分から OGP を取り出す(純関数)。baseUrl は、画像の相対URLを絶対にするための、ページのURL */
export function parsePageInfo(html: string, baseUrl: string): PageInfo {
  const limited = html.length > MAX_PARSE_CHARS ? html.slice(0, MAX_PARSE_CHARS) : html;
  const headEnd = limited.search(/<\/head\s*>/i);
  const head = headEnd >= 0 ? limited.slice(0, headEnd) : limited;
  const meta = new Map<string, string>();
  let tags = 0;
  for (const m of head.matchAll(new RegExp(`<meta\\b[^>]{0,${MAX_TAG_CHARS}}>`, "gi"))) {
    if (++tags > MAX_META_TAGS) break;
    const a = metaAttrs(m[0]);
    const key = (a.get("property") ?? a.get("name") ?? "").toLowerCase();
    const content = a.get("content");
    if (key !== "" && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const text = (v: string | undefined) => {
    if (v === undefined) return null;
    const t = squash(decodeEntities(v));
    return t === "" ? null : t;
  };
  const titleTag = /<title\b[^>]{0,256}>([^<]{0,2000})<\/title\s*>/i.exec(head)?.[1];
  const title = text(meta.get("og:title")) ?? text(meta.get("twitter:title")) ?? text(titleTag);
  const description = text(meta.get("og:description")) ?? text(meta.get("twitter:description")) ?? text(meta.get("description"));
  const imageRaw = text(meta.get("og:image")) ?? text(meta.get("og:image:url")) ?? text(meta.get("twitter:image")) ?? text(meta.get("twitter:image:src"));
  let thumbnail: string | null = null;
  if (imageRaw) {
    try {
      const resolved = new URL(imageRaw, baseUrl);
      // http:// の画像は、https:// に読み替える(このアプリは https なので、http の画像は、ブラウザが読まない。読み込めなければ、画面で地球儀に戻る)
      if (resolved.protocol === "http:" && resolved.port === "") resolved.protocol = "https:";
      const safe = parseHttpsUrl(resolved.toString());
      // 画面を開くたびに、ブラウザがこのURLを読み込む。内部向けのホストは指させない
      if (safe && safe.length <= MAX_IMAGE_URL && !isBlockedHost(new URL(safe).hostname)) thumbnail = safe;
    } catch {
      thumbnail = null;
    }
  }
  return {
    title: title === null ? null : clip(title, MAX_FETCHED_TITLE),
    description: description === null ? null : clip(description, MAX_DESCRIPTION),
    thumbnail_url: thumbnail,
  };
}

// 先頭の MAX_PAGE_BYTES まで読む(超えたら、そこで読むのをやめる。失敗にはしない: <head> は先頭にあるため)
async function readHead(res: Response, deadline: Promise<never>): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // 少しずつ返す遅い応答でも、全体の期限で打ち切る
    const { done, value } = await Promise.race([reader.read(), deadline]);
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= MAX_PAGE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const all = new Uint8Array(Math.min(total, MAX_PAGE_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - offset));
    all.set(part, offset);
    offset += part.byteLength;
    if (offset >= all.length) break;
  }
  return all;
}

// 文字コード: 応答のヘッダー、無ければ <meta charset> / http-equiv。読めない名前は UTF-8
function decodeBody(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)?.[1];
  const ascii = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(ascii)?.[1];
  const label = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// fetchImpl はテスト用の差し替え。成功すれば PageInfo(何も取れなければ全部 null)、失敗は TitleFetchError(理由つき)を投げる
export async function fetchPageInfo(url: string, fetchImpl: typeof fetch = fetch, options: { timeoutMs?: number } = {}): Promise<PageInfo> {
  const first = parseHttpsUrl(url);
  if (first === null) throw new TitleFetchError("ページのURLが https ではありません");
  let current: string = first;
  const startHost = new URL(current).hostname;
  if (isBlockedHost(startHost)) throw new TitleFetchError("このホストのページは、取りに行きません");
  // 期限は、転送も本文の読み込みも含めた全体で1つ
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  const deadline = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), { once: true }));
  deadline.catch(() => undefined);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetchImpl(current, {
        method: "GET",
        headers: { accept: "text/html,application/xhtml+xml;q=0.9", "accept-language": "ja,en;q=0.8", "user-agent": "ReceiptToLifePlus-LinkPreview/1.0" },
        redirect: "manual",
        signal,
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      let next: URL | null = null;
      try {
        next = location ? new URL(location, current) : null;
      } catch {
        next = null;
      }
      await res.body?.cancel().catch(() => undefined);
      const nextUrl: string | null = next ? parseHttpsUrl(next.toString()) : null;
      if (!next || nextUrl === null || !sameSite(next.hostname, startHost) || isBlockedHost(next.hostname)) {
        throw new TitleFetchError("ページが、別のサイトへ転送しようとしました");
      }
      current = nextUrl;
      res = null;
    }
    if (!res) throw new TitleFetchError("ページの転送が多すぎます");
    if (!res.ok) {
      const hint = res.status === 404 ? "(ページが見つからない)" : res.status === 401 || res.status === 403 ? "(取得が許可されていない)" : res.status === 429 ? "(アクセスが多すぎて制限された)" : "";
      await res.body?.cancel().catch(() => undefined);
      throw new TitleFetchError(`ページが ${res.status} を返しました${hint}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await res.body?.cancel().catch(() => undefined);
      throw new TitleFetchError("ページが HTML ではありません");
    }
    const bytes = await readHead(res, deadline);
    if (bytes === null) throw new TitleFetchError("ページの中身を読み取れませんでした");
    const info = parsePageInfo(decodeBody(bytes, contentType), current);
    if (info.title === null && info.description === null && info.thumbnail_url === null) throw new TitleFetchError("ページにタイトルや説明がありませんでした");
    return info;
  } catch (e) {
    if (e instanceof TitleFetchError) throw e;
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new TitleFetchError(timeout ? "ページが3秒以内に応答しませんでした" : "ページへの通信に失敗しました");
  }
}

export type ImageCheck = { ok: boolean; note: string };

// 画像のURLが本当に画像として読めるかを確かめる(AIが poster_url / cover_url に入れる前の確認用)。
// https だけ・内部向けのホストは不可。リダイレクトは https の公開ホストへ最大2回。3秒で打ち切る。中身は読まず、ヘッダーだけ見て閉じる
export async function checkImageUrl(url: string, fetchImpl: typeof fetch = fetch, options: { timeoutMs?: number } = {}): Promise<ImageCheck> {
  let current = parseHttpsUrl(url);
  if (current === null) return { ok: false, note: "画像のURLが https ではありません" };
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= 2; hop++) {
      if (isBlockedHost(new URL(current).hostname)) return { ok: false, note: "このホストの画像は、確かめに行きません" };
      const res = await fetchImpl(current, {
        method: "GET",
        headers: { accept: "image/*", range: "bytes=0-0", "user-agent": "ReceiptToLifePlus-LinkPreview/1.0" },
        redirect: "manual",
        signal,
      });
      await res.body?.cancel().catch(() => undefined);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        let next: string | null = null;
        try {
          next = location ? parseHttpsUrl(new URL(location, current).toString()) : null;
        } catch {
          next = null;
        }
        if (next === null) return { ok: false, note: "画像が、https ではない場所へ転送されました" };
        current = next;
        continue;
      }
      if (res.status !== 200 && res.status !== 206) return { ok: false, note: `画像が ${res.status} を返しました${res.status === 404 ? "(見つからない)" : ""}` };
      const type = res.headers.get("content-type") ?? "";
      if (!/^image\//i.test(type)) return { ok: false, note: "画像ではないものが返りました" };
      return { ok: true, note: "画像を読めることを確認しました" };
    }
    return { ok: false, note: "画像の転送が多すぎます" };
  } catch {
    return { ok: false, note: "画像への通信に失敗しました(3秒以内に応答がない場合を含む)" };
  }
}

export type PagePreview = { url: string; title: string | null; description: string | null; image_url: string | null; image_ok: boolean | null; image_note: string };

// preview_page の本体。ページの OGP を読み、画像があれば本当に読めるかも確かめる
export async function previewPage(url: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; preview: PagePreview } | { ok: false; errors: string[] }> {
  const safe = parseHttpsUrl(url);
  if (safe === null) return { ok: false, errors: ["url は https のURLで指定してください"] };
  try {
    const info = await fetchPageInfo(safe, fetchImpl);
    const check = info.thumbnail_url ? await checkImageUrl(info.thumbnail_url, fetchImpl) : null;
    return {
      ok: true,
      preview: {
        url: safe,
        title: info.title,
        description: info.description,
        image_url: info.thumbnail_url,
        image_ok: check ? check.ok : null,
        image_note: check ? check.note : "このページには画像(og:image)がありません",
      },
    };
  } catch (e) {
    return { ok: false, errors: [e instanceof TitleFetchError ? e.message : "ページを読めませんでした"] };
  }
}
