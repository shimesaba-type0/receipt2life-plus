const JST = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

// 今日の日付(Asia/Tokyo)を YYYY-MM-DD で返す
export function todayJst(now: Date = new Date()): string {
  return JST.format(now);
}

// YYYY-MM-DD の形式で、実在する日付か
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
