import { formatYen } from "../format";

// 月の比較カードの純粋な部分(DOMに触れない。テストする)

export type BaseChoice = "previous" | "year_ago" | "custom";

export const BASE_OPTIONS: { value: BaseChoice; label: string }[] = [
  { value: "previous", label: "先月" },
  { value: "year_ago", label: "前年の同じ月" },
  { value: "custom", label: "月を指定" },
];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// API の base。月を指定で、月が正しくなければ null(まだ比べられない)
export function baseParam(choice: BaseChoice, custom: string): string | null {
  if (choice !== "custom") return choice;
  return MONTH.test(custom) ? custom : null;
}

// API のパス。until_day は、同じ日までにそろえるときだけ付ける
export function compareApiPath(month: string, base: string, untilDay: number | null): string {
  const params = new URLSearchParams({ month, base });
  if (untilDay !== null) params.set("until_day", String(untilDay));
  return `/api/compare?${params.toString()}`;
}

// 途中の月(今月)だけ、「同じ日まで」にそろえられる。その日(今日)を返す。過去の月は null
export function defaultUntilDay(month: string, today: string): number | null {
  return today.slice(0, 7) === month ? Number(today.slice(8, 10)) : null;
}

// 「+¥12,000」「-¥3,000」「±¥0」
export function signedYen(n: number): string {
  if (n === 0) return "±¥0";
  return `${n > 0 ? "+" : "-"}${formatYen(Math.abs(n))}`;
}

// 「+15%」「-8.5%」。比べる側が0円で割合が出ないときは「—」
export function percentLabel(p: number | null): string {
  if (p === null) return "—";
  if (p === 0) return "±0%";
  return `${p > 0 ? "+" : "-"}${Math.abs(p)}%`;
}

// 増減の向き(色・矢印に使う)。増えた=up、減った=down
export function deltaDirection(n: number): "up" | "down" | "flat" {
  return n > 0 ? "up" : n < 0 ? "down" : "flat";
}

export const DIRECTION_MARK: Record<"up" | "down" | "flat", string> = { up: "▲", down: "▼", flat: "＝" };

// 「2026年9月」(月の表示名)
export function monthTitle(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}
