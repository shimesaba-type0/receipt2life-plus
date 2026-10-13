import type { LinkKind } from "./links";

// リンクのタイトルの取得(公式の oEmbed だけ。ページの本文・OGP・画像には取りに行かない)
// 取りに行く先は、次の2つの固定のホストだけ(リンクのURLは検索の値として渡す。リンクのホストへは行かない):
//   YouTube: https://www.youtube.com/oembed → title
//   X:       https://publish.twitter.com/oembed → 投稿者名と、投稿の本文の先頭
// Instagram は公式の oEmbed に事前の登録(アクセストークン)が要るため、取りに行かない(null)
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

export function oembedEndpoint(kind: Exclude<LinkKind, "instagram">, url: string): string {
  const q = encodeURIComponent(url);
  return kind === "youtube" ? `https://www.youtube.com/oembed?format=json&url=${q}` : `https://publish.twitter.com/oembed?omit_script=1&url=${q}`;
}

// 取得に失敗した理由(画面とログに出す)。タイトルが取れなかったときに、原因を切り分けるため
export class TitleFetchError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "TitleFetchError";
  }
}

// 手動でたどってよいリダイレクト先(固定のホストだけ)。oEmbed が公式の別のホストに移っていても、取れるようにする
const REDIRECT_HOSTS = new Set(["www.youtube.com", "youtube.com", "publish.twitter.com", "publish.x.com"]);
const MAX_REDIRECTS = 2;
const SERVICE: Record<"youtube" | "x", string> = { youtube: "YouTube", x: "X" };

// fetchImpl はテスト用の差し替え。成功すればタイトル、タイトルが無ければ null、失敗は TitleFetchError(理由つき)を投げる
export function makeTitleFetcher(fetchImpl: typeof fetch = fetch): TitleFetcher {
  return async (kind, url) => {
    if (kind === "instagram") return null;
    const service = SERVICE[kind];
    let endpoint = oembedEndpoint(kind, url);
    try {
      let res: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        res = await fetchImpl(endpoint, { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.status < 300 || res.status >= 400) break;
        const location = res.headers.get("location");
        const next = location ? new URL(location, endpoint) : null;
        if (!next || next.protocol !== "https:" || !REDIRECT_HOSTS.has(next.hostname)) {
          throw new TitleFetchError(`${service}の取得先が、想定外の場所(${next?.hostname ?? "不明"})へ移そうとしました`);
        }
        endpoint = next.toString();
        res = null;
      }
      if (!res) throw new TitleFetchError(`${service}の取得先の転送が多すぎます`);
      if (!res.ok) {
        const hint = res.status === 401 || res.status === 403 ? "(埋め込みが許可されていない、または非公開の可能性)" : res.status === 404 ? "(動画・投稿が見つからない、または削除・非公開)" : res.status === 429 ? "(アクセスが多すぎて制限された)" : "";
        throw new TitleFetchError(`${service}が ${res.status} を返しました${hint}`);
      }
      const text = await readLimited(res);
      if (text === null) throw new TitleFetchError(`${service}の応答が大きすぎます`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new TitleFetchError(`${service}の応答を読み取れませんでした`);
      }
      const title = kind === "youtube" ? titleFromYouTube(json) : titleFromX(json);
      if (title === null) throw new TitleFetchError(`${service}の応答にタイトルがありませんでした`);
      return title;
    } catch (e) {
      if (e instanceof TitleFetchError) throw e;
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new TitleFetchError(timeout ? `${service}が3秒以内に応答しませんでした` : `${service}への通信に失敗しました`);
    }
  };
}

export const fetchLinkTitle: TitleFetcher = makeTitleFetcher();
