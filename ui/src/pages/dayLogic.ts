import type { CategoriesData, LinkView, TaxFlag } from "../../../src/api/contract";
import { UI_TAX_FLAG_LABELS } from "../taxFlags";

// 「大分類・カテゴリ」を1つのチップ文言にする。大分類が分からない・同名ならカテゴリ名だけ。未設定は null
export function categoryChipLabel(category: string | null, cats: CategoriesData): string | null {
  if (!category) return null;
  const found = cats.categories.find((c) => c.name === category);
  return found && found.group_name !== category ? `${found.group_name}・${category}` : category;
}

// ---- リンク(Xの投稿・YouTubeの動画)の表示用 ----

export function linkKindLabel(kind: LinkView["kind"]): string {
  return kind === "youtube" ? "YouTube" : "X";
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
