import { monthRange } from "./calendar";
import { todayJst } from "./dates";
import type { FieldError } from "./schema";
import { summarize, type SummaryRow } from "./summarize";
import { TX_VIEW_COLUMNS, type CoreOptions, type TransactionView } from "./transactions";

export interface HomeResult {
  ok: true;
  today: { date: string; total: number; count: number };
  month: { month: string; from: string; to: string; total: number; count: number };
  groups: SummaryRow[];
  memo: { with_memo: number; total: number; percent: number };
  needs_review: number;
  recent: TransactionView[];
}

// ホーム画面の集計。月の集計は summarize(大分類)を使い回す
export async function getHome(db: D1Database, options: CoreOptions = {}): Promise<HomeResult | { ok: false; errors: FieldError[] }> {
  const today = todayJst(options.now);
  const month = today.slice(0, 7);
  const { from, to } = monthRange(month);

  const [byGroup, todayRow, memoRow, review, recent] = await Promise.all([
    summarize(db, { from, to, group_by: "group" }),
    db
      .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM transactions WHERE date = ?")
      .bind(today)
      .first<{ count: number; total: number }>(),
    // メモの割合は、今月の取引が対象(空文字のメモはメモなし)
    db
      .prepare(
        "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN memo IS NOT NULL AND memo != '' THEN 1 ELSE 0 END), 0) AS with_memo FROM transactions WHERE date >= ? AND date <= ?",
      )
      .bind(from, to)
      .first<{ total: number; with_memo: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'needs_review'").first<{ n: number }>(),
    db
      .prepare(
        `SELECT ${TX_VIEW_COLUMNS}
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN accounts a ON a.id = t.account_id
         ORDER BY t.date DESC, t.created_at DESC, t.id
         LIMIT 5`,
      )
      .all<TransactionView>(),
  ]);
  if (!byGroup.ok) return byGroup;

  const memoTotal = memoRow?.total ?? 0;
  const withMemo = memoRow?.with_memo ?? 0;
  return {
    ok: true,
    today: { date: today, total: todayRow?.total ?? 0, count: todayRow?.count ?? 0 },
    month: { month, from, to, total: byGroup.total, count: byGroup.count },
    groups: byGroup.rows,
    memo: { with_memo: withMemo, total: memoTotal, percent: memoTotal === 0 ? 0 : Math.round((withMemo / memoTotal) * 1000) / 10 },
    needs_review: review?.n ?? 0,
    recent: recent.results,
  };
}
