import type { LinkKind } from "./links";

// リンクのタイトルの取得(公式の oEmbed だけ。ページの本文・OGP・画像には取りに行かない)
// 取りに行く先は、次の2つの固定のホストだけ(リンクのURLは検索の値として渡す。リンクのホストへは行かない):
//   YouTube: https://www.youtube.com/oembed → title
//   X:       https://publish.twitter.com/oembed → 投稿者名と、投稿の本文の先頭
// 失敗(通信エラー・タイムアウト・削除された動画や非公開の投稿・仕様の変更)は null を返す。タイトルが付かないだけで、リンクの登録は成功する

export type TitleFetcher = (kind: LinkKind, url: string) => Promise<string | null>;

export const MAX_FETCHED_TITLE = 200;
const TIMEOUT_MS = 3000;
// 応答の大きさの上限(oEmbed の JSON は数KB)
const MAX_BODY_BYTES = 64 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function clip(s: string): string {
  const chars = [...s];
  return chars.length <= MAX_FETCHED_TITLE ? s : `${chars.slice(0, MAX_FETCHED_TITLE - 1).join("")}…`;
}

// YouTube の oEmbed の JSON から、動画のタイトル
export function titleFromYouTube(json: unknown): string | null {
  const title = (json as { title?: unknown } | null)?.title;
  if (typeof title !== "string") return null;
  const t = squash(title);
  return t === "" ? null : clip(t);
}

// X の oEmbed の JSON から、「投稿者名: 本文の先頭」。html の中の最初の <p> を本文とする(タグは消し、文字参照は戻す)
export function titleFromX(json: unknown): string | null {
  const o = json as { author_name?: unknown; html?: unknown } | null;
  if (!o || typeof o.html !== "string") return null;
  const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(o.html);
  if (!p?.[1]) return null;
  const body = squash(decodeEntities(p[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")));
  if (body === "") return null;
  const author = typeof o.author_name === "string" ? squash(decodeEntities(o.author_name)) : "";
  return clip(author ? `${author}: ${body}` : body);
}

async function readLimited(res: Response): Promise<string | null> {
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function oembedEndpoint(kind: LinkKind, url: string): string {
  const q = encodeURIComponent(url);
  return kind === "youtube" ? `https://www.youtube.com/oembed?format=json&url=${q}` : `https://publish.twitter.com/oembed?omit_script=1&url=${q}`;
}

// fetchImpl はテスト用の差し替え
export function makeTitleFetcher(fetchImpl: typeof fetch = fetch): TitleFetcher {
  return async (kind, url) => {
    try {
      const res = await fetchImpl(oembedEndpoint(kind, url), {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const text = await readLimited(res);
      if (text === null) return null;
      const json: unknown = JSON.parse(text);
      return kind === "youtube" ? titleFromYouTube(json) : titleFromX(json);
    } catch {
      return null;
    }
  };
}

export const fetchLinkTitle: TitleFetcher = makeTitleFetcher();
