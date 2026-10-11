// 国民の祝日を計算する純関数(外部APIなし。2000〜2099年)
// 簡易化: 振替休日は 2007年以降の規則(日曜の祝日の後で最初の祝日でない日)を全期間に使う

const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// 曜日(0=日)。UTC で計算するので実行環境のタイムゾーンに依存しない
function weekday(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 月の第 n 月曜日の日
function nthMonday(y: number, m: number, n: number): number {
  return 1 + ((8 - weekday(y, m, 1)) % 7) + (n - 1) * 7;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

function equinoxDay(y: number, base: number): number {
  const k = y - 1980;
  return Math.floor(base + 0.242194 * k - Math.floor(k / 4));
}

// 振替休日・国民の休日を除いた、その年の祝日
function baseHolidays(y: number): Map<string, string> {
  const h = new Map<string, string>();
  const set = (m: number, d: number, name: string) => h.set(ymd(y, m, d), name);

  set(1, 1, "元日");
  set(1, nthMonday(y, 1, 2), "成人の日");
  set(2, 11, "建国記念の日");
  if (y >= 2020) set(2, 23, "天皇誕生日");
  set(3, equinoxDay(y, 20.8431), "春分の日");
  set(4, 29, y >= 2007 ? "昭和の日" : "みどりの日");
  set(5, 3, "憲法記念日");
  if (y >= 2007) set(5, 4, "みどりの日");
  set(5, 5, "こどもの日");

  if (y === 2020) set(7, 23, "海の日");
  else if (y === 2021) set(7, 22, "海の日");
  else set(7, y >= 2003 ? nthMonday(y, 7, 3) : 20, "海の日");

  if (y === 2020) set(8, 10, "山の日");
  else if (y === 2021) set(8, 8, "山の日");
  else if (y >= 2016) set(8, 11, "山の日");

  set(9, y >= 2003 ? nthMonday(y, 9, 3) : 15, "敬老の日");
  set(9, equinoxDay(y, 23.2488), "秋分の日");

  if (y === 2020) set(7, 24, "スポーツの日");
  else if (y === 2021) set(7, 23, "スポーツの日");
  else set(10, nthMonday(y, 10, 2), y >= 2022 ? "スポーツの日" : "体育の日");

  set(11, 3, "文化の日");
  set(11, 23, "勤労感謝の日");
  if (y <= 2018) set(12, 23, "天皇誕生日");

  if (y === 2019) {
    set(5, 1, "休日(天皇の即位の日)");
    set(10, 22, "休日(即位礼正殿の儀)");
  }
  return h;
}

const cache = new Map<number, Map<string, string>>();

function yearHolidays(y: number): Map<string, string> {
  const cached = cache.get(y);
  if (cached) return cached;
  const all = baseHolidays(y);
  const base = [...all.keys()].sort();

  // 振替休日: 日曜の祝日の後で最初の祝日でない日。日付の昇順に処理する
  for (const date of base) {
    if (!isSunday(date)) continue;
    let d = nextDay(date);
    while (all.has(d)) d = nextDay(d);
    all.set(d, "振替休日");
  }

  // 国民の休日: 前日と翌日がどちらも通常の祝日で、日曜でも祝日でもない日
  const baseSet = new Set(base);
  for (const date of base) {
    const mid = nextDay(date);
    if (baseSet.has(nextDay(mid)) && !all.has(mid) && !isSunday(mid)) all.set(mid, "国民の休日");
  }

  cache.set(y, all);
  return all;
}

// 年が範囲内なら、その年の祝日表を返す
function tableFor(date: string): Map<string, string> | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= MIN_YEAR && y <= MAX_YEAR ? yearHolidays(y) : null;
}

// 祝日の名称。祝日でない日・範囲外(2000〜2099年以外)は null
export function holidayName(date: string): string | null {
  return tableFor(date)?.get(date) ?? null;
}

// 月(YYYY-MM)の祝日を日付昇順で返す
export function holidaysInMonth(month: string): { date: string; name: string }[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const table = tableFor(`${month}-01`);
  if (!table) return [];
  return [...table.entries()]
    .filter(([date]) => date.startsWith(`${month}-`))
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 一覧用の日付表記。"2026-10-12" → "10/12(月)"
export function formatHolidayDate(date: string): string {
  const wd = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${wd})`;
}
