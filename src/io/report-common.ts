import type { EventView } from "../core/events";
import type { PeriodReport } from "../core/period-report";

// Markdown / HTML の描画で共通の部品(文言、日付、色、カレンダーの並び)

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// 出来事の色。Markdown では絵文字、HTML では色コード
export const EVENT_EMOJI: Record<string, string> = { red: "🟥", orange: "🟧", green: "🟩", blue: "🟦", purple: "🟪" };
export const EVENT_HEX: Record<string, string> = { red: "#C0504D", orange: "#D98A3D", green: "#4F8F6B", blue: "#4A7FB5", purple: "#8466A8" };
export const emojiOf = (color: string) => EVENT_EMOJI[color] ?? "⬜";

export const yen = (n: number) => `${n < 0 ? "-" : ""}¥${Math.abs(n).toLocaleString("en-US")}`;

export const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] as string;

export const eventPeriod = (e: Pick<EventView, "start_date" | "end_date">) => (e.end_date ? `${e.start_date}〜${e.end_date}` : e.start_date);

// その日にかかっている出来事
export const eventsOn = (events: readonly EventView[], date: string) =>
  events.filter((e) => e.start_date <= date && (e.end_date ?? e.start_date) >= date);

export interface CalendarMonth {
  // YYYY-MM
  month: string;
  title: string;
  // 週ごとの7マス。月の外・期間の外は null
  weeks: (string | null)[][];
}

// 期間にかかる月ごとのカレンダー(日曜はじまり)。期間の外の日は空欄にする
export function calendarMonths(from: string, to: string): CalendarMonth[] {
  const out: CalendarMonth[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  const last = to.slice(0, 7);
  for (;;) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    if (month > last) break;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      cells.push(date >= from && date <= to ? date : null);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    out.push({ month, title: `${y}年${m}月`, weeks });
    if (m === 12) {
      y += 1;
      m = 1;
    } else m += 1;
  }
  return out;
}

export const dayNumber = (date: string) => String(Number(date.slice(8, 10)));

// 1日あたりの平均(期間の日数で割る。円未満は四捨五入)
export function dailyAverage(report: Pick<PeriodReport, "total" | "period">): number {
  const days = Math.round((Date.parse(`${report.period.to}T00:00:00Z`) - Date.parse(`${report.period.from}T00:00:00Z`)) / 86_400_000) + 1;
  return Math.round(report.total / days);
}

export const exportedOn = (now: Date) => now.toISOString().slice(0, 10);

// 取引1件の見出し行の材料(店名、時刻、カテゴリ・口座)
export function txHeadline(t: { merchant: string | null; paid_time: string | null }): string {
  return t.merchant && t.merchant !== "" ? t.merchant : "(店名なし)";
}

export function txMeta(t: { category: string | null; account: string | null; paid_time: string | null }): string[] {
  return [t.paid_time, t.category, t.account].filter((v): v is string => v !== null && v !== "");
}

export function seatLine(r: { title: string | null; venue: string; screen: string | null; seat: string; seat_class: string | null; rating: number | null }): string {
  const place = [r.venue, r.screen].filter((v): v is string => !!v).join(" ");
  const seat = [r.seat_class, r.seat].filter((v): v is string => !!v).join(" ");
  const rating = r.rating !== null ? ` ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}` : "";
  return `${r.title ? `${r.title} / ` : ""}${place} ${seat}${rating}`;
}
