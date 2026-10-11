import { summarizeSchema, type GroupBy } from "./report-schema";
import { toFieldErrors, type FieldError } from "./schema";

export interface SummaryRow {
  key: string;
  label: string;
  count: number;
  total: number;
  percent: number;
}

export type SummarizeResult =
  | {
      ok: true;
      group_by: GroupBy;
      from: string | null;
      to: string | null;
      total: number;
      count: number;
      rows: SummaryRow[];
      message: string;
    }
  | { ok: false; errors: FieldError[] };

interface RawRow {
  key: string | null;
  label?: string | null;
  count: number;
  total: number;
}

const NO_CATEGORY = "(未分類)";
const NO_MERCHANT = "(店名なし)";
const NO_EVENT = "(出来事なし)";
const TOP_N = 3;

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const percentOf = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 取引の日付が出来事の範囲(start_date〜end_date、なければ単日)に入る、という条件
const IN_EVENT = "t.date >= e.start_date AND t.date <= COALESCE(e.end_date, e.start_date)";

export async function summarize(db: D1Database, input: unknown): Promise<SummarizeResult> {
  const parsed = summarizeSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { from, to, group_by: groupBy } = parsed.data;
  if (from && to && from > to) {
    return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };
  }

  const conds: string[] = [];
  const params: string[] = [];
  if (from) {
    conds.push("t.date >= ?");
    params.push(from);
  }
  if (to) {
    conds.push("t.date <= ?");
    params.push(to);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const andWhere = conds.length ? ` AND ${conds.join(" AND ")}` : "";

  // 全体の合計と件数(割合の分母)。集計はすべてDB側で行う
  const totals = await db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total FROM transactions t ${where}`)
    .bind(...params)
    .first<{ count: number; total: number }>();
  const total = totals?.total ?? 0;
  const count = totals?.count ?? 0;

  let raw: RawRow[];
  if (groupBy === "event_id") {
    const [byEvent, none] = await Promise.all([
      db
        .prepare(
          `SELECT e.id AS key, e.title AS label, COUNT(*) AS count, SUM(t.amount) AS total
           FROM transactions t JOIN events e ON ${IN_EVENT}
           ${where}
           GROUP BY e.id, e.title`,
        )
        .bind(...params)
        .all<RawRow>(),
      db
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total FROM transactions t
           WHERE NOT EXISTS (SELECT 1 FROM events e WHERE ${IN_EVENT})${andWhere}`,
        )
        .bind(...params)
        .first<{ count: number; total: number }>(),
    ]);
    raw = byEvent.results;
    if (none && none.count > 0) raw.push({ key: NO_EVENT, label: NO_EVENT, count: none.count, total: none.total });
  } else {
    const { expr, join } = groupExpr(groupBy);
    const { results } = await db
      .prepare(
        `SELECT ${expr} AS key, COUNT(*) AS count, SUM(t.amount) AS total
         FROM transactions t ${join}
         ${where}
         GROUP BY ${expr}`,
      )
      .bind(...params)
      .all<RawRow>();
    raw = results;
  }

  const rows: SummaryRow[] = raw.map((r) => {
    const key = r.key ?? (groupBy === "merchant" ? NO_MERCHANT : NO_CATEGORY);
    return { key, label: r.label ?? key, count: r.count, total: r.total, percent: percentOf(r.total, total) };
  });
  rows.sort(groupBy === "month" ? (a, b) => cmp(a.key, b.key) : (a, b) => b.total - a.total || cmp(a.key, b.key));

  return {
    ok: true,
    group_by: groupBy,
    from: from ?? null,
    to: to ?? null,
    total,
    count,
    rows,
    message: buildMessage(groupBy, from, to, total, count, rows),
  };
}

function groupExpr(groupBy: Exclude<GroupBy, "event_id">): { expr: string; join: string } {
  switch (groupBy) {
    case "category":
      return { expr: "c.name", join: "LEFT JOIN categories c ON c.id = t.category_id" };
    case "group":
      return { expr: "c.group_name", join: "LEFT JOIN categories c ON c.id = t.category_id" };
    case "month":
      return { expr: "substr(t.date, 1, 7)", join: "" };
    case "merchant":
      return { expr: "t.merchant", join: "" };
  }
}

function buildMessage(
  groupBy: GroupBy,
  from: string | undefined,
  to: string | undefined,
  total: number,
  count: number,
  rows: SummaryRow[],
): string {
  const range = !from && !to ? "全期間" : `${from ?? ""}〜${to ?? ""}`;
  if (count === 0) return `${range}: 記録された支出はありません`;
  const top = [...rows].sort((a, b) => b.total - a.total || cmp(a.key, b.key)).slice(0, TOP_N);
  const parts = top.map((r) => `${r.label} ${r.percent.toFixed(1)}%`);
  const tail = rows.length > top.length ? " …" : "";
  const note = groupBy === "event_id" ? "。複数の出来事に入る取引はそれぞれに数えるため、行の合計は全体を超えることがあります" : "";
  return `${range}: ${count}件 合計${yen(total)}(${parts.join("、")}${tail})。記録した範囲の集計です${note}`;
}
