import type { UsageDayView, UsageLevel, UsageMeterView } from "../../../src/api/contract";

// 使用量ページの純粋な部分(DOMに触れない。テストする)

export const LEVEL_LABELS: Record<UsageLevel, string> = { ok: "余裕あり", warn: "注意", danger: "上限に近い" };

// 「12.3%」(小数第1位まで。0.05%未満は「0%」、100%を超えたらそのまま)
export function percentText(ratio: number): string {
  const p = Math.round(ratio * 1000) / 10;
  return `${p}%`;
}

// 棒の長さ(%)。0〜100に収める。値があるのに細すぎて見えないときは、最小の幅にする
export function barWidth(ratio: number): number {
  if (!(ratio > 0)) return 0;
  return Math.min(100, Math.max(1.5, ratio * 100));
}

// 「450万」「12,300」。万の単位は、万以上のときだけ
export function compactCount(n: number): string {
  if (n >= 10_000) {
    const man = Math.round(n / 1000) / 10;
    return `${man.toLocaleString("ja-JP")}万`;
  }
  return n.toLocaleString("ja-JP");
}

// 「◯◯ / 上限」(例: 4万 / 10万)
export function meterText(m: Pick<UsageMeterView, "used" | "limit">): string {
  return `${compactCount(m.used)} / ${compactCount(m.limit)}`;
}

// 日ごとの棒グラフ用の高さ(%)。日々の値のうち、上限と最大値の大きいほうを100%にする
export function dayBars(days: readonly UsageDayView[], pick: (d: UsageDayView) => number, limit: number): { date: string; value: number; height: number; over: boolean }[] {
  const max = Math.max(limit, ...days.map(pick), 1);
  return days.map((d) => {
    const value = pick(d);
    return { date: d.date, value, height: value <= 0 ? 0 : Math.max(2, (value / max) * 100), over: value >= limit };
  });
}

// 上限の線の高さ(%)
export function limitLine(days: readonly UsageDayView[], pick: (d: UsageDayView) => number, limit: number): number {
  const max = Math.max(limit, ...days.map(pick), 1);
  return (limit / max) * 100;
}

// "2026-10-14" → "10/14"
export function shortDay(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}/${Number(m[2])}` : date;
}

// ホームに注意を出すか(注意以上)と、その文言
export function homeNotice(level: UsageLevel, read: UsageMeterView, write: UsageMeterView): string | null {
  if (level === "ok") return null;
  const worse = write.ratio >= read.ratio ? { name: "書いた行", m: write } : { name: "読んだ行", m: read };
  const head = level === "danger" ? "D1 の今日の使用量が、上限に近づいています" : "D1 の今日の使用量が、増えています";
  return `${head}(${worse.name}が上限の ${percentText(worse.m.ratio)})`;
}
