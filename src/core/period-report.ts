import { z } from "zod";
import { isRealDate, todayJst } from "./dates";
import { listEvents, type EventView } from "./events";
import { withItems } from "./items";
import type { LinkView } from "./links";
import { listSeatRecords, type SeatRecordView } from "./seat-records";
import { toFieldErrors, type FieldError } from "./schema";
import { summarize, type SummaryRow } from "./summarize";
import { TX_VIEW_COLUMNS, type CoreOptions, type TransactionRow, type TransactionView } from "./transactions";

// 期間のレポート(Markdown / HTML エクスポートの材料)。読み取り専用。描画は src/io/report-*.ts

// 期間の上限(日数)。1年(うるう年を含む)まで
export const MAX_REPORT_DAYS = 366;

export const reportPeriodSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month: YYYY-MM 形式で指定してください(例: 2026-10)").optional(),
  year: z.string().regex(/^\d{4}$/, "year: YYYY 形式で指定してください(例: 2026)").optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from: YYYY-MM-DD 形式で指定してください").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to: YYYY-MM-DD 形式で指定してください").optional(),
});

export interface ReportPeriod {
  from: string;
  to: string;
  // 見出しに使う名前(例: 2026年10月、2026年、2026-10-01〜2026-10-31)
  title: string;
  // ファイル名に使う(例: 2026-10、2026、20261001-20261031)
  slug: string;
}

export type ResolvePeriodResult = { ok: true; period: ReportPeriod } | { ok: false; errors: FieldError[] };

const fail = (field: string, message: string): ResolvePeriodResult => ({ ok: false, errors: [{ field, message }] });

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// 日付の差(日数、両端を含む)
function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// month / year / from+to のどれか1つで期間を決める。何も無ければ今月
export function resolveReportPeriod(input: unknown, options: CoreOptions = {}): ResolvePeriodResult {
  const parsed = reportPeriodSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { month, year, from, to } = parsed.data;

  const modes = [month !== undefined, year !== undefined, from !== undefined || to !== undefined].filter(Boolean).length;
  if (modes > 1) return fail("month", "month・year・(from と to)は、どれか1つだけ指定してください");

  if (year !== undefined) {
    return { ok: true, period: { from: `${year}-01-01`, to: `${year}-12-31`, title: `${year}年`, slug: year } };
  }
  if (from !== undefined || to !== undefined) {
    if (from === undefined || to === undefined) return fail(from === undefined ? "from" : "to", "from と to は、両方指定してください");
    if (!isRealDate(from)) return fail("from", "from: 実在しない日付です");
    if (!isRealDate(to)) return fail("to", "to: 実在しない日付です");
    if (from > to) return fail("from", "from: from は to 以前の日付にしてください");
    if (inclusiveDays(from, to) > MAX_REPORT_DAYS) return fail("to", `期間は${MAX_REPORT_DAYS}日までにしてください(長い期間は分けて書き出してください)`);
    return { ok: true, period: { from, to, title: `${from}〜${to}`, slug: `${from.replaceAll("-", "")}-${to.replaceAll("-", "")}` } };
  }
  const target = month ?? todayJst(options.now).slice(0, 7);
  const [y, m] = target.split("-").map(Number) as [number, number];
  return {
    ok: true,
    period: { from: `${target}-01`, to: `${target}-${String(lastDayOf(y, m)).padStart(2, "0")}`, title: `${y}年${m}月`, slug: target },
  };
}

export interface ReportPhoto {
  caption: string | null;
}

export interface ReportDay {
  date: string;
  total: number;
  transactions: TransactionView[];
  photos: ReportPhoto[];
  links: LinkView[];
  seat_records: SeatRecordView[];
}

export interface PeriodReport {
  period: ReportPeriod;
  total: number;
  // 取引(レシート)の件数
  count: number;
  categories: SummaryRow[];
  // 日ごとの支出の合計(支出のある日だけ)
  day_totals: Record<string, number>;
  events: EventView[];
  // 支出・写真・リンク・座席の記録のどれかがある日(日付順)
  days: ReportDay[];
}

export type PeriodReportResult = ({ ok: true } & PeriodReport) | { ok: false; errors: FieldError[] };

interface DatedRow {
  d: string;
}

export async function buildPeriodReport(db: D1Database, period: ReportPeriod): Promise<PeriodReportResult> {
  const { from, to } = period;
  const [txs, summary, events, photos, links, seats] = await Promise.all([
    db
      .prepare(
        `SELECT ${TX_VIEW_COLUMNS}
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.date >= ? AND t.date <= ?
         ORDER BY t.date, (t.paid_time IS NULL), t.paid_time, t.created_at, t.id`,
      )
      .bind(from, to)
      .all<TransactionRow>(),
    summarize(db, { from, to, group_by: "category" }),
    listEvents(db, { from, to, limit: 500 }),
    // 写真・リンクは、日付そのもの → 取引の日 → 出来事の開始日 の順で、載せる日を決める
    db
      .prepare(
        `SELECT COALESCE(a.date, t.date, e.start_date) AS d, a.caption
         FROM attachments a
         LEFT JOIN transactions t ON t.id = a.transaction_id
         LEFT JOIN events e ON e.id = a.event_id
         WHERE COALESCE(a.date, t.date, e.start_date) >= ? AND COALESCE(a.date, t.date, e.start_date) <= ?
         ORDER BY d, a.created_at, a.id`,
      )
      .bind(from, to)
      .all<DatedRow & ReportPhoto>(),
    db
      .prepare(
        `SELECT COALESCE(l.date, t.date, e.start_date) AS d, l.id, l.url, l.kind, l.title, l.date, l.transaction_id, l.event_id, l.created_at
         FROM links l
         LEFT JOIN transactions t ON t.id = l.transaction_id
         LEFT JOIN events e ON e.id = l.event_id
         WHERE COALESCE(l.date, t.date, e.start_date) >= ? AND COALESCE(l.date, t.date, e.start_date) <= ?
         ORDER BY d, l.created_at, l.id`,
      )
      .bind(from, to)
      .all<DatedRow & LinkView>(),
    listSeatRecords(db, { from, to, limit: 500 }),
  ]);
  if (!summary.ok) return summary;
  if (!events.ok) return events;
  if (!seats.ok) return seats;

  const transactions = await withItems(db, txs.results);

  const byDate = new Map<string, ReportDay>();
  const day = (date: string): ReportDay => {
    let d = byDate.get(date);
    if (!d) {
      d = { date, total: 0, transactions: [], photos: [], links: [], seat_records: [] };
      byDate.set(date, d);
    }
    return d;
  };
  const dayTotals: Record<string, number> = {};
  for (const t of transactions) {
    const d = day(t.date);
    d.transactions.push(t);
    d.total += t.amount;
    dayTotals[t.date] = (dayTotals[t.date] ?? 0) + t.amount;
  }
  for (const p of photos.results) day(p.d).photos.push({ caption: p.caption });
  for (const { d, ...link } of links.results) day(d).links.push(link);
  // 座席の記録は新しい順で返るので、古い順に入れ直す
  for (const r of [...seats.records].reverse()) day(r.date).seat_records.push(r);

  return {
    ok: true,
    period,
    total: summary.total,
    count: summary.count,
    categories: summary.rows,
    day_totals: dayTotals,
    events: events.events,
    days: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}
