import { z } from "zod";
import { isRealDate, todayJst } from "./dates";
import { listEvents, type EventView } from "./events";
import { listPhotosOnDay, photoOnDay, type PhotoView } from "./photos";
import type { FieldError } from "./schema";
import type { CoreOptions, TransactionView } from "./transactions";

// カレンダーと日別の集計(読み取り専用)

export interface CalendarDay {
  date: string;
  total: number;
  count: number;
  photos: number;
}

export type CalendarResult =
  | { ok: true; month: string; total: number; days: CalendarDay[]; events: EventView[] }
  | { ok: false; errors: FieldError[] };

export type DayResult =
  | { ok: true; date: string; total: number; count: number; transactions: TransactionView[]; events: EventView[]; photos: PhotoView[] }
  | { ok: false; errors: FieldError[] };

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// 月の最初の日と最後の日
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export async function getCalendar(db: D1Database, month: string | undefined, options: CoreOptions = {}): Promise<CalendarResult> {
  const target = month ?? todayJst(options.now).slice(0, 7);
  if (!monthSchema.safeParse(target).success) {
    return { ok: false, errors: [{ field: "month", message: "month: YYYY-MM 形式で指定してください(例: 2026-10)" }] };
  }
  const { from, to } = monthRange(target);

  const { results } = await db
    .prepare(
      `SELECT d.date, d.total, d.count,
         (SELECT COUNT(*) FROM attachments a WHERE ${photoOnDay("d.date")}) AS photos
       FROM (SELECT date, SUM(amount) AS total, COUNT(*) AS count FROM transactions WHERE date >= ? AND date <= ? GROUP BY date) d
       ORDER BY d.date`,
    )
    .bind(from, to)
    .all<CalendarDay>();

  const events = await listEvents(db, { from, to, limit: 500 });
  if (!events.ok) return events;
  return { ok: true, month: target, total: results.reduce((s, d) => s + d.total, 0), days: results, events: events.events };
}

export async function getDay(db: D1Database, date: string): Promise<DayResult> {
  if (!isRealDate(date)) {
    return { ok: false, errors: [{ field: "date", message: "date: YYYY-MM-DD 形式の実在する日付で指定してください(例: 2026-10-11)" }] };
  }
  const [txs, events, photos] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.date, t.amount, t.merchant, c.name AS category, a.name AS account, t.memo, t.source, t.status
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.date = ?
         ORDER BY t.created_at, t.id`,
      )
      .bind(date)
      .all<TransactionView>(),
    listEvents(db, { from: date, to: date, limit: 500 }),
    listPhotosOnDay(db, date),
  ]);
  if (!events.ok) return events;
  const total = txs.results.reduce((s, t) => s + t.amount, 0);
  return { ok: true, date, total, count: txs.results.length, transactions: txs.results, events: events.events, photos };
}
