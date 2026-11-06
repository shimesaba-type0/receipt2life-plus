import type { SeatRecordView } from "../../../src/api/contract";

// 映画の画面の、画面に依存しない部分(テストする)。映画は座席の記録(作品名・日付・映画館・座席・評価)を並べたもの

/** 評価の星(5つのうち、評価の数だけ塗る)。評価がなければ空文字 */
export function ratingStars(rating: number | null): string {
  if (rating === null || rating < 1) return "";
  const n = Math.min(5, Math.round(rating));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

/** 一覧のカードの見出し。作品名がなければ、映画館の名前 */
export function movieHeading(r: Pick<SeatRecordView, "title" | "venue">): string {
  return r.title?.trim() || `(作品名なし)${r.venue}`;
}

/** 座席の行の文言(スクリーン・座席・席種) */
export function seatText(r: Pick<SeatRecordView, "screen" | "seat" | "seat_class">): string {
  return [r.screen, r.seat, r.seat_class && `(${r.seat_class})`].filter(Boolean).join(" ");
}

/** 件数の見出し */
export function movieCountText(count: number): string {
  return count === 0 ? "該当する映画の記録はありません。" : `${count}件`;
}
