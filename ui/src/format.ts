// 表示用の整形。日付は YYYY-MM-DD、時刻の基準は Asia/Tokyo

const JST_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

export function todayJst(now: Date = new Date()): string {
  return JST_DATE.format(now);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

// 曜日(0=日〜6=土)。タイムゾーンに左右されないよう、UTCで数える
export function weekdayIndex(date: string): number {
  return utcDate(date).getUTCDay();
}

// "2026-10-11" → "2026年10月11日(日)"
export function formatDateJa(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y}年${Number(m)}月${Number(d)}日(${WEEKDAYS[weekdayIndex(date)]})`;
}

// "2026-10" → "2026年10月"
export function formatMonthJa(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

// 月を前後に動かす。"2026-12" + 1 → "2027-01"
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// 月の最初の日と最後の日
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
