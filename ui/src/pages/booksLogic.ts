import type { BookPatch, BookView, NewBook } from "../../../src/api/contract";

// 本の画面の、画面に依存しない部分(テストする)

export interface BookForm {
  isbn: string;
  title: string;
  author: string;
  series: string;
  buyer: string;
  note: string;
  purchased_on: string;
}

export const EMPTY_FORM: BookForm = { isbn: "", title: "", author: "", series: "", buyer: "", note: "", purchased_on: "" };

export function formFromBook(b: BookView): BookForm {
  return { isbn: b.isbn ?? "", title: b.title ?? "", author: b.author ?? "", series: b.series ?? "", buyer: b.buyer ?? "", note: b.note ?? "", purchased_on: b.purchased_on ?? "" };
}

/** ISBN もタイトルも空のときの案内(送る前に出す)。問題なければ null */
export function checkForm(f: BookForm): string | null {
  if (f.isbn.trim() === "" && f.title.trim() === "") return "ISBN かタイトルのどちらかを入れてください。";
  return null;
}

/** 追加の入力。空の項目は送らない */
export function newBookFrom(f: BookForm): NewBook {
  const out: NewBook = {};
  for (const key of ["isbn", "title", "author", "series", "buyer", "note", "purchased_on"] as const) {
    const v = f[key].trim();
    if (v !== "") out[key] = v;
  }
  return out;
}

/** 直す入力。変えた項目だけ送る(空にしたものは null で消去) */
export function patchFrom(before: BookForm, after: BookForm): BookPatch {
  const out: BookPatch = {};
  for (const key of ["isbn", "title", "author", "series", "buyer", "note", "purchased_on"] as const) {
    const b = before[key].trim();
    const a = after[key].trim();
    if (a !== b) out[key] = a === "" ? null : a;
  }
  return out;
}

/** 一覧の見出しの件数 */
export function countText(count: number, shown: number): string {
  if (count === 0) return "該当する本はありません。";
  return shown < count ? `${count}冊(新しい順に${shown}冊を表示)` : `${count}冊`;
}

/** 13桁の ISBN を、読みやすくハイフンで区切る(978-4-…の区切りは国で違うので、頭の3桁と末尾の1桁だけ分ける) */
export function isbnText(isbn: string | null): string {
  if (!isbn || isbn.length !== 13) return isbn ?? "";
  return `${isbn.slice(0, 3)}-${isbn.slice(3, 12)}-${isbn.slice(12)}`;
}
