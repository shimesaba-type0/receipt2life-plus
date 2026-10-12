import { spendLines } from "./items";
import { summarizeDiscounts, type SummarizeDiscountsResult } from "./discounts";
import { summarizeSchema, summarizeToolSchema, type GroupBy } from "./report-schema";
import { NO_TAX_FLAG_LABEL, TAX_FLAG_LABELS, type TaxFlag } from "./tax-flags";
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
      // 期間内の取引(レシート)の件数
      count: number;
      // 期間内の支出の行の数(明細がある取引は明細の行数、無い取引は1)。rows の count の単位
      lines: number;
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

// 支出の行の日付が出来事の範囲(start_date〜end_date、なければ単日)に入る、という条件
const IN_EVENT = "l.date >= e.start_date AND l.date <= COALESCE(e.end_date, e.start_date)";

// MCP の summarize の入口。discounts_only: true なら割引の集計(summarizeDiscounts)、それ以外は従来の summarize
// 従来の入力・返り値は変えない(discounts_only を付けなければ、これまでと同じ結果)
export async function summarizeForTool(db: D1Database, input: unknown): Promise<SummarizeResult | SummarizeDiscountsResult> {
  const parsed = summarizeToolSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { discounts_only: discountsOnly, ...rest } = parsed.data;
  return discountsOnly ? summarizeDiscounts(db, rest) : summarize(db, rest);
}

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
  // 集計の土台は「支出の行」(明細がある取引は各明細行、無い取引は取引そのもの)。行の amount の総和は取引の amount の総和と一致する
  const lines = spendLines(conds, params);

  // 全体の合計と件数(割合の分母)。集計はすべてDB側で行う。count は取引(レシート)の件数、lines は支出の行の数
  const [totals, lineTotals] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total FROM transactions t ${where}`)
      .bind(...params)
      .first<{ count: number; total: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM ${lines.sql} l`).bind(...lines.params).first<{ n: number }>(),
  ]);
  const total = totals?.total ?? 0;
  const count = totals?.count ?? 0;
  const lineCount = lineTotals?.n ?? 0;

  let raw: RawRow[];
  if (groupBy === "event_id") {
    const [byEvent, none] = await Promise.all([
      db
        .prepare(
          `SELECT e.id AS key, e.title AS label, COUNT(*) AS count, SUM(l.amount) AS total
           FROM ${lines.sql} l JOIN events e ON ${IN_EVENT}
           GROUP BY e.id, e.title`,
        )
        .bind(...lines.params)
        .all<RawRow>(),
      db
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(l.amount), 0) AS total FROM ${lines.sql} l
           WHERE NOT EXISTS (SELECT 1 FROM events e WHERE ${IN_EVENT})`,
        )
        .bind(...lines.params)
        .first<{ count: number; total: number }>(),
    ]);
    raw = byEvent.results;
    if (none && none.count > 0) raw.push({ key: NO_EVENT, label: NO_EVENT, count: none.count, total: none.total });
  } else {
    const { expr, join } = groupExpr(groupBy);
    const { results } = await db
      .prepare(
        `SELECT ${expr} AS key, COUNT(*) AS count, SUM(l.amount) AS total
         FROM ${lines.sql} l ${join}
         GROUP BY ${expr}`,
      )
      .bind(...lines.params)
      .all<RawRow>();
    raw = results;
  }

  const rows: SummaryRow[] = raw.map((r) => {
    if (groupBy === "tax_flag") {
      const flag = r.key as TaxFlag | null;
      const label = flag ? (TAX_FLAG_LABELS[flag] ?? flag) : NO_TAX_FLAG_LABEL;
      return { key: flag ?? NO_TAX_FLAG_LABEL, label, count: r.count, total: r.total, percent: percentOf(r.total, total) };
    }
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
    lines: lineCount,
    rows,
    message: buildMessage(groupBy, from, to, total, count, rows),
  };
}

function groupExpr(groupBy: Exclude<GroupBy, "event_id">): { expr: string; join: string } {
  switch (groupBy) {
    case "category":
      return { expr: "c.name", join: "LEFT JOIN categories c ON c.id = l.category_id" };
    case "group":
      return { expr: "c.group_name", join: "LEFT JOIN categories c ON c.id = l.category_id" };
    case "month":
      return { expr: "substr(l.date, 1, 7)", join: "" };
    case "merchant":
      return { expr: "l.merchant", join: "" };
    case "tax_flag":
      return { expr: "l.tax_flag", join: "" };
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
  const note = groupBy === "event_id" ? "。複数の出来事に入る支出はそれぞれに数えるため、行の合計は全体を超えることがあります" : "";
  return `${range}: ${count}件 合計${yen(total)}(${parts.join("、")}${tail})。記録した範囲の集計です${note}`;
}
