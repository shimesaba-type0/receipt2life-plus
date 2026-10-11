// 年月ピッカーの純関数(DOMに触れない。テストする)
// 年の範囲は暫定で 2000〜2099(SPEC第13節に追記の候補)
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2099;

export function clampYear(year: number): number {
  if (!Number.isFinite(year)) return MIN_YEAR;
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(year)));
}

export function shiftYear(year: number, delta: number): number {
  return clampYear(year + delta);
}

// "2026-10" → 2026(読めなければ下限)
export function parseYear(month: string): number {
  return clampYear(Number(month.slice(0, 4)));
}

export interface MonthButton {
  month: string; // YYYY-MM
  label: string; // "10月"
  current: boolean; // 今月
  selected: boolean; // 表示中の月
}

export function monthButtons(year: number, todayMonth: string, shownMonth: string): MonthButton[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month, label: `${i + 1}月`, current: month === todayMonth, selected: month === shownMonth };
  });
}

export function monthHref(month: string): string {
  return `/calendar?month=${month}`;
}

// 実在する日付で、年の範囲内か
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false;
  const y = Number(value.slice(0, 4));
  return y >= MIN_YEAR && y <= MAX_YEAR;
}
