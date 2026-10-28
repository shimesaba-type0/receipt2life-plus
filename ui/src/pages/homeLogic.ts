// ホーム画面の表示ロジック(DOMに触れない純関数。テストする)
import type { HomeData, SummaryRow, TransactionView } from "../../../src/api/contract";
import { formatYen } from "../format";

// 内訳バーの色。主色の濃淡 → 砂色 → 灰。出来事の色(赤橙緑青紫)と混ざらないようにする
export const GROUP_COLORS = ["#1F5C4B", "#5E9C86", "#A9CDBF", "#C9B27A", "#B8BEBB", "#9CA5A1"] as const;
const GRAYS = ["#B8BEBB", "#9CA5A1"] as const;

// 7番目以降は灰系を交互に使う
export function groupColor(index: number): string {
  if (index < GROUP_COLORS.length) return GROUP_COLORS[index] as string;
  return GRAYS[index % GRAYS.length] as string;
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

// ---- ドーナツグラフ ----
// 目に優しい白・黒(真っ白・真っ黒は使わない)。ドーナツの中の文字色に使う
export const PAPER = "#F1F4F2";
export const INK = "#1B2420";

// "#RRGGBB" の相対輝度(WCAG)
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// 背景色の上で、読みやすいほう(明るい白か暗い黒)の文字色
export function textColorOn(bg: string): string {
  return contrast(PAPER, bg) >= contrast(INK, bg) ? PAPER : INK;
}

export const DONUT = { size: 160, r: 56, stroke: 26 } as const;
// ドーナツの中に % を入れる区分: 大きいほうから最大 5 つ、かつ 10% 以上(小さい区分は一覧で見る)
export const DONUT_MAX_LABELS = 5;
export const DONUT_MIN_LABEL_PERCENT = 10;

export interface DonutSlice {
  key: string;
  label: string;
  color: string;
  percent: number;
  // 円周に沿った線の長さと、始まりのずれ(stroke-dasharray / stroke-dashoffset)
  dash: number;
  gap: number;
  offset: number;
  // リングの中の % の文字。入れない区分は null
  inner: { x: number; y: number; text: string; color: string } | null;
}

// 大分類別の内訳を、ドーナツの区分にする。金額が0以下は出さない。上から時計回り(12時から)
export function donutSlices(groups: SummaryRow[]): DonutSlice[] {
  const segs = barSegments(groups);
  const { size, r } = DONUT;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const single = segs.length === 1;
  const gapLen = single ? 0 : 1.6;
  // % を入れる区分(大きい順で最大5つ、10%以上)
  const labeled = new Set(
    [...segs]
      .sort((a, b) => b.total - a.total)
      .filter((s) => s.width >= DONUT_MIN_LABEL_PERCENT)
      .slice(0, DONUT_MAX_LABELS)
      .map((s) => s.key),
  );
  let start = 0; // 0〜1
  return segs.map((s) => {
    const frac = s.width / 100;
    const len = circ * frac;
    const mid = start + frac / 2;
    const angle = mid * 2 * Math.PI - Math.PI / 2;
    const slice: DonutSlice = {
      key: s.key,
      label: s.label,
      color: s.color,
      percent: s.percent,
      dash: Math.max(len - gapLen, 0.01),
      gap: circ - Math.max(len - gapLen, 0.01),
      offset: -circ * start,
      inner: labeled.has(s.key)
        ? { x: c + r * Math.cos(angle), y: c + r * Math.sin(angle), text: `${Math.round(s.percent)}%`, color: textColorOn(s.color) }
        : null,
    };
    start += frac;
    return slice;
  });
}

export interface MemoView {
  withMemo: number;
  total: number;
  percent: number;
  text: string;
  // 「38%」(整数に丸める)と「11 / 29件」
  percentText: string;
  ratioText: string;
}

// メモ付き支出の割合。percent が不正でも件数から計算し直す
export function memoView(memo: HomeData["memo"]): MemoView {
  const percent = memo.total > 0 ? percentOf(memo.with_memo, memo.total) : 0;
  return {
    withMemo: memo.with_memo,
    total: memo.total,
    percent,
    percentText: `${Math.round(percent)}%`,
    ratioText: `${memo.with_memo} / ${memo.total}件`,
    text: memo.total > 0 ? `${memo.total}件中 ${memo.with_memo}件にメモがあります(${formatPercent(percent)})` : "まだ支出がありません",
  };
}

// 記録がまったく無いか
export function isEmptyHome(data: HomeData): boolean {
  return data.month.count === 0 && data.today.count === 0 && data.recent.length === 0;
}

// 要確認のタップ先。要確認の記録だけを並べた一覧
export function reviewHref(): string {
  return "/review";
}

export function reviewLabel(count: number): string {
  return `要確認の記録が${count}件あります`;
}

// 最近の記録1行の店名。無ければ「店名なし」(要確認チップを添える目印にする)
export function recentMerchant(t: TransactionView): { title: string; missing: boolean } {
  const name = t.merchant?.trim();
  return name ? { title: name, missing: false } : { title: "店名なし", missing: true };
}

// サブ行「食費・現金」(カテゴリ・口座。無い方は省く)
export function recentSub(t: TransactionView): string {
  return [t.category?.trim(), t.account?.trim()].filter((x): x is string => !!x).join("・");
}

// 今月の範囲「10月1日〜11日」。終わりは今日(今月の外なら月末)
export function monthRangeLabel(from: string, today: string): string {
  const [, m, d1] = from.split("-");
  const [y, mo] = from.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const inMonth = today.slice(0, 7) === from.slice(0, 7);
  const end = inMonth ? Number(today.split("-")[2]) : last;
  const start = Number(d1);
  return end > start ? `${Number(m)}月${start}日〜${end}日` : `${Number(m)}月${start}日`;
}

// 日付 "2026-10-11" を "10/11" にする
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : date;
}

export interface DiscountsView {
  // 今月の割引がないか(合計0かつ行数0)
  empty: boolean;
  // 「¥1,230」。ないときは空
  amountText: string;
  // 「3件の割引」。ないときは「今月の割引はまだありません」
  countText: string;
  // 小さな補足。数えられるのは印字された割引行だけ
  note: string;
  ariaLabel: string;
}

export const DISCOUNTS_NOTE = "印字された割引行のみ";

// ホームの「今月の割引」カードの表示用。値が不正(負・小数・欠け)でも壊れないようにする
export function discountsView(discounts: HomeData["discounts"] | undefined): DiscountsView {
  const total = Number.isFinite(discounts?.month_total) ? Math.max(0, Math.round(discounts?.month_total ?? 0)) : 0;
  const lines = Number.isFinite(discounts?.month_line_count) ? Math.max(0, Math.round(discounts?.month_line_count ?? 0)) : 0;
  if (lines === 0 && total === 0) {
    return { empty: true, amountText: "", countText: "今月の割引はまだありません", note: DISCOUNTS_NOTE, ariaLabel: "今月の割引はまだありません" };
  }
  const amountText = formatYen(total);
  const countText = `${lines}件の割引`;
  return { empty: false, amountText, countText, note: DISCOUNTS_NOTE, ariaLabel: `今月の割引 ${amountText}、${countText}` };
}
