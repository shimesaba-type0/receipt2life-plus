import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./booksLogic";

// 本の一覧の1ページの件数を、このブラウザに覚えておく(端末ごとの好み。無くても動く)
const PAGE_SIZE_KEY = "r2l.books.pageSize";

/** 保存された1ページの件数。選べる値でなければ既定 */
export function readPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

export function savePageSize(n: number): void {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(n));
  } catch {
    // 保存できなくても、画面は動く
  }
}

