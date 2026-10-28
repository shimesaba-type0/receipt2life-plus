import type { TransactionView } from "../../../src/api/contract";

// 要確認の一覧の、画面に依存しない部分(テストする)

/** なぜ要確認か。店名が無ければそれ、あればカテゴリの不足(要確認で店名があるのは、カテゴリが無い行があるとき) */
export function reviewReason(t: Pick<TransactionView, "merchant">): string {
  return t.merchant?.trim() ? "カテゴリがありません" : "店名がありません";
}

export function reviewTitle(t: Pick<TransactionView, "merchant">): string {
  return t.merchant?.trim() || "店名なし";
}

/** 件数の見出し */
export function reviewCountText(count: number): string {
  return count === 0 ? "要確認の記録はありません。" : `要確認の記録が${count}件あります。新しい日付から並べています。`;
}
