import type { BookPatch, BookView, NewBook } from "../../../src/api/contract";

export type BookStatus = BookView["status"];
// 手元の状況(選ぶ順)。売った金額は記録しない
export const BOOK_STATUS_OPTIONS: { value: BookStatus; label: string }[] = [
  { value: "owned", label: "手元にある" },
  { value: "sold", label: "売った" },
  { value: "given", label: "譲った・贈った" },
  { value: "donated", label: "寄贈した" },
  { value: "lost", label: "なくした" },
  { value: "discarded", label: "処分した" },
];
export const statusLabel = (v: BookStatus): string => BOOK_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;

// 本の画面の、画面に依存しない部分(テストする)

export interface BookForm {
  isbn: string;
  title: string;
  author: string;
  series: string;
  buyer: string;
  note: string;
  cover_url: string;
  status: BookStatus;
  released_on: string;
  purchased_on: string;
}

export const EMPTY_FORM: BookForm = { isbn: "", title: "", author: "", series: "", buyer: "", note: "", cover_url: "", status: "owned", released_on: "", purchased_on: "" };

export function formFromBook(b: BookView): BookForm {
  return { isbn: b.isbn ?? "", title: b.title ?? "", author: b.author ?? "", series: b.series ?? "", buyer: b.buyer ?? "", note: b.note ?? "", cover_url: b.cover_url ?? "", status: b.status, released_on: b.released_on ?? "", purchased_on: b.purchased_on ?? "" };
}

/** ISBN もタイトルも空のときの案内(送る前に出す)。問題なければ null */
export function checkForm(f: BookForm): string | null {
  if (f.isbn.trim() === "" && f.title.trim() === "") return "ISBN かタイトルのどちらかを入れてください。";
  return null;
}

/** 追加の入力。空の項目は送らない */
export function newBookFrom(f: BookForm): NewBook {
  const out: NewBook = {};
  for (const key of ["isbn", "title", "author", "series", "buyer", "note", "cover_url", "purchased_on"] as const) {
    const v = f[key].trim();
    if (v !== "") out[key] = v;
  }
  if (f.status !== "owned") {
    out.status = f.status;
    if (f.released_on.trim() !== "") out.released_on = f.released_on.trim();
  }
  return out;
}

/** 直す入力。変えた項目だけ送る(空にしたものは null で消去) */
export function patchFrom(before: BookForm, after: BookForm): BookPatch {
  const out: BookPatch = {};
  if (after.status !== before.status) out.status = after.status;
  for (const key of ["isbn", "title", "author", "series", "buyer", "note", "cover_url", "released_on", "purchased_on"] as const) {
    if (key === "released_on" && after.status === "owned") continue;
    const b = before[key].trim();
    const a = after[key].trim();
    if (a !== b) out[key] = a === "" ? null : a;
  }
  return out;
}

/** 一覧の見出しの件数 */
export function countText(count: number): string {
  return count === 0 ? "該当する本はありません。" : `${count}冊`;
}

/** 13桁の ISBN を、読みやすくハイフンで区切る(978-4-…の区切りは国で違うので、頭の3桁と末尾の1桁だけ分ける) */
export function isbnText(isbn: string | null): string {
  if (!isbn || isbn.length !== 13) return isbn ?? "";
  return `${isbn.slice(0, 3)}-${isbn.slice(3, 12)}-${isbn.slice(12)}`;
}

// カバー画像がないときの表紙の色(タイトルから決める。同じ本はいつも同じ色)
const COVER_COLORS: { bg: string; fg: string }[] = [
  { bg: "#1f5c4b", fg: "#e3efea" },
  { bg: "#3b66b0", fg: "#e8eef8" },
  { bg: "#b4493c", fg: "#fbe9e6" },
  { bg: "#b46a1c", fg: "#fdf0de" },
  { bg: "#5b6762", fg: "#eef1ef" },
  { bg: "#3e7f5c", fg: "#e3f3ea" },
  { bg: "#6a4c93", fg: "#efe9f6" },
  { bg: "#2f7f8f", fg: "#e2f1f4" },
];

export function coverColor(seed: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of seed) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return COVER_COLORS[h % COVER_COLORS.length]!;
}

/** 一覧のカードの見出し(タイトルがなければ ISBN) */
export function bookHeading(b: Pick<BookView, "title" | "isbn">): string {
  return b.title ?? (b.isbn ? `ISBN ${isbnText(b.isbn)}` : "(無題)");
}

// ---- ページ送り(1ページの件数は、5段階から選べる) ----

export const PAGE_SIZES = [12, 24, 48, 96, 200] as const;
export const DEFAULT_PAGE_SIZE = 24;
/** 全件数とページの件数からのページ数(0件でも1) */
export const pageCountOf = (total: number, size: number): number => Math.max(1, Math.ceil(total / size));
