import type { CategoriesData, LinkView, TaxFlag } from "../../../src/api/contract";
import { UI_TAX_FLAG_LABELS } from "../taxFlags";

// 「大分類・カテゴリ」を1つのチップ文言にする。大分類が分からない・同名ならカテゴリ名だけ。未設定は null
export function categoryChipLabel(category: string | null, cats: CategoriesData): string | null {
  if (!category) return null;
  const found = cats.categories.find((c) => c.name === category);
  return found && found.group_name !== category ? `${found.group_name}・${category}` : category;
}

// ---- リンク(Xの投稿・YouTubeの動画・Instagramの投稿)の表示用 ----

export function linkKindLabel(kind: LinkView["kind"]): string {
  return kind === "youtube" ? "YouTube" : kind === "instagram" ? "Instagram" : "X";
}

// URLをホスト+パスに短くする(https:// と www. は省く)。読めないURLはそのまま。max を超えたら末尾を「…」にする
export function shortenUrl(url: string, max = 48): string {
  let text = url;
  try {
    const u = new URL(url);
    text = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    // そのまま使う
  }
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

// カードの見出し。タイトルがあればそれ、無ければURLの短縮表示
export function linkDisplayText(link: Pick<LinkView, "url" | "title">): string {
  const title = link.title?.trim();
  return title ? title : shortenUrl(link.url);
}

// Xの投稿のURLから、投稿のID(数字)。投稿のURLでなければ(プロフィールなど)null。埋め込み表示に使う
export function tweetIdOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/.test(u.hostname)) return null;
    const m = /^\/[^/]+\/status\/(\d{1,25})\/?$/.exec(u.pathname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

// YouTube の動画のURLから、動画のID(11文字)。再生リストだけのURLなど、動画のIDが無ければ null
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export function youtubeVideoIdOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const host = u.hostname;
    const path = u.pathname.replace(/\/$/, "");
    let id: string | null | undefined = null;
    if (host === "youtu.be") id = /^\/([^/]+)$/.exec(path)?.[1];
    else if (/^(www\.|m\.|music\.)?youtube\.com$/.test(host)) {
      id = path === "/watch" ? u.searchParams.get("v") : /^\/(?:shorts|live)\/([^/]+)$/.exec(path)?.[1];
    }
    return id && VIDEO_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

// サムネイルの画像のURL(YouTube が公開している、動画のIDから決まるURL。16:9で、黒帯が付かない mqdefault。サーバーは取りに行かない)
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

// href に入れてよいのは https だけ(サーバーも保証するが、画面側でも念のため確認する)
export function isSafeLinkHref(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// ---- 税金のフラグ ----

// 選択肢(先頭は「なし」。value が空文字のものがフラグなし)
export const TAX_FLAG_OPTIONS: { value: "" | TaxFlag; label: string }[] = [
  { value: "", label: "なし" },
  ...(Object.keys(UI_TAX_FLAG_LABELS) as TaxFlag[]).map((value) => ({ value, label: UI_TAX_FLAG_LABELS[value] })),
];

// select の値を API に送る値にする。空や知らない値はフラグなし(null)
export function parseTaxFlagField(value: string): TaxFlag | null {
  return Object.prototype.hasOwnProperty.call(UI_TAX_FLAG_LABELS, value) ? (value as TaxFlag) : null;
}

// 支出の行に出すチップの文言。フラグなしは null
export function taxFlagChipLabel(flag: TaxFlag | null | undefined): string | null {
  return flag ? (UI_TAX_FLAG_LABELS[flag] ?? null) : null;
}
