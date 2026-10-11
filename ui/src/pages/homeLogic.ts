// ホーム画面の表示ロジック(DOMに触れない純関数。テストする)
import type { HomeData, SummaryRow, TransactionView } from "../../../src/api/contract";

// 積み上げバーの色(白い背景・隣同士で見分けがつく順)
export const GROUP_COLORS = ["#1f5c4b", "#3b73c9", "#d9822b", "#7c5bb5", "#c94b3f", "#3e9b68", "#5b6762"] as const;

export function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length] as string;
}

// 割合の表示。小数1桁までに丸め、整数なら小数を出さない。範囲は0〜100に収める
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "0%";
  const clamped = Math.min(100, Math.max(0, percent));
  return `${Math.round(clamped * 10) / 10}%`;
}

// 件数と全体から割合を出す(全体が0なら0)
export function percentOf(part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 1000) / 10);
}

export interface BarSegment {
  key: string;
  label: string;
  total: number;
  percent: number;
  // 積み上げバーでの幅(%)。合計が100になる
  width: number;
  color: string;
}

// 大分類別の内訳をバーの区間にする。金額が0以下の行は出さない。幅は金額の比で決める
export function barSegments(groups: SummaryRow[]): BarSegment[] {
  const rows = groups.filter((g) => g.total > 0);
  const sum = rows.reduce((acc, g) => acc + g.total, 0);
  if (sum <= 0) return [];
  return rows.map((g, i) => ({
    key: g.key,
    label: g.label,
    total: g.total,
    percent: g.percent,
    width: (g.total / sum) * 100,
    color: groupColor(i),
  }));
}

export interface MemoView {
  withMemo: number;
  total: number;
  percent: number;
  text: string;
}

// メモ付き支出の割合。percent が不正でも件数から計算し直す
export function memoView(memo: HomeData["memo"]): MemoView {
  const percent = memo.total > 0 ? percentOf(memo.with_memo, memo.total) : 0;
  return {
    withMemo: memo.with_memo,
    total: memo.total,
    percent,
    text: memo.total > 0 ? `${memo.total}件中 ${memo.with_memo}件にメモがあります(${formatPercent(percent)})` : "まだ支出がありません",
  };
}

// 記録がまったく無いか
export function isEmptyHome(data: HomeData): boolean {
  return data.month.count === 0 && data.today.count === 0 && data.recent.length === 0;
}

// 要確認のタップ先。直近に要確認があればその日、なければその月のカレンダー
export function reviewHref(data: Pick<HomeData, "recent" | "month">): string {
  const target = data.recent.find((t) => t.status === "needs_review");
  return target ? `/day/${target.date}` : `/calendar?month=${data.month.month}`;
}

export function reviewLabel(count: number): string {
  return `要確認の支出が${count}件あります`;
}

// 最近の記録1行の見出し(店名がなければカテゴリ、それもなければ「支出」)
export function recentTitle(t: TransactionView): string {
  return t.merchant?.trim() || t.category?.trim() || "支出";
}

// 日付 "2026-10-11" を "10/11" にする
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : date;
}
