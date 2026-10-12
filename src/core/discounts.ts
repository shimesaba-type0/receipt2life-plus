import { spendLines } from "./items";
import { summarizeDiscountsSchema, type DiscountGroupBy } from "./report-schema";
import { toFieldErrors, type FieldError } from "./schema";

// 割引の集計。数えるのは、支出の行(spendLines)のうち、明細の行で amount < 0 のものだけ(レシートに印字された割引・値引き・クーポンの行)
// 明細のない取引は、取引の金額がマイナスでも数えない(割引ではなく返品・払い戻しの可能性があるため)
// 最初から安い値段や、印字されないポイント還元は見えない

export interface DiscountRow {
  key: string;
  // 割引の合計(正の円。マイナスの行の絶対値の合計)
  total: number;
  line_count: number;
  // その割引の行を持つ取引(レシート)の件数
  receipt_count: number;
}

export type SummarizeDiscountsResult =
  | {
      ok: true;
      group_by: DiscountGroupBy;
      from: string | null;
      to: string | null;
      // 割引の合計(正の円)
      total: number;
      line_count: number;
      receipt_count: number;
      // 同じ期間の支出の合計(summarize の total と同じ定義。割合を出すための参考)
      spend_total: number;
      // group_by が none のときは空
      rows: DiscountRow[];
      message: string;
    }
  | { ok: false; errors: FieldError[] };

interface RawRow {
  key: string | null;
  total: number;
  line_count: number;
  receipt_count: number;
}

const NO_CATEGORY = "(未分類)";
const NO_MERCHANT = "(店名なし)";
const DISCOUNT_LINE = "l.item_id IS NOT NULL AND l.amount < 0";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function summarizeDiscounts(db: D1Database, input: unknown): Promise<SummarizeDiscountsResult> {
  const parsed = summarizeDiscountsSchema.safeParse(input ?? {});
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
  const lines = spendLines(conds, params);

  const [totals, spend] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS line_count, COUNT(DISTINCT l.transaction_id) AS receipt_count, COALESCE(-SUM(l.amount), 0) AS total
         FROM ${lines.sql} l WHERE ${DISCOUNT_LINE}`,
      )
      .bind(...lines.params)
      .first<{ line_count: number; receipt_count: number; total: number }>(),
    db.prepare(`SELECT COALESCE(SUM(t.amount), 0) AS total FROM transactions t ${where}`).bind(...params).first<{ total: number }>(),
  ]);
  const total = totals?.total ?? 0;
  const lineCount = totals?.line_count ?? 0;
  const receiptCount = totals?.receipt_count ?? 0;
  const spendTotal = spend?.total ?? 0;

  let rows: DiscountRow[] = [];
  if (groupBy !== "none") {
    const { expr, join } = groupExpr(groupBy);
    const { results } = await db
      .prepare(
        `SELECT ${expr} AS key, COALESCE(-SUM(l.amount), 0) AS total, COUNT(*) AS line_count, COUNT(DISTINCT l.transaction_id) AS receipt_count
         FROM ${lines.sql} l ${join}
         WHERE ${DISCOUNT_LINE}
         GROUP BY ${expr}`,
      )
      .bind(...lines.params)
      .all<RawRow>();
    rows = results.map((r) => ({
      key: r.key ?? (groupBy === "merchant" ? NO_MERCHANT : NO_CATEGORY),
      total: r.total,
      line_count: r.line_count,
      receipt_count: r.receipt_count,
    }));
    rows.sort(groupBy === "month" ? (a, b) => cmp(a.key, b.key) : (a, b) => b.total - a.total || cmp(a.key, b.key));
  }

  const range = !from && !to ? "全期間" : `${from ?? ""}〜${to ?? ""}`;
  const message =
    lineCount === 0
      ? `${range}: レシートに印字された割引の行はありません。印字された割引行だけの集計で、最初から安い値段やポイント還元は含まれません`
      : `${range}: 割引${lineCount}行(${receiptCount}件のレシート) 合計${yen(total)}(同じ期間の支出は合計${yen(spendTotal)})。レシートに印字された割引行(マイナスの明細)だけの集計で、最初から安い値段や印字されないポイント還元は含まれません`;

  return { ok: true, group_by: groupBy, from: from ?? null, to: to ?? null, total, line_count: lineCount, receipt_count: receiptCount, spend_total: spendTotal, rows, message };
}

function groupExpr(groupBy: Exclude<DiscountGroupBy, "none">): { expr: string; join: string } {
  switch (groupBy) {
    case "category":
      return { expr: "c.name", join: "LEFT JOIN categories c ON c.id = l.category_id" };
    case "month":
      return { expr: "substr(l.date, 1, 7)", join: "" };
    case "merchant":
      return { expr: "l.merchant", join: "" };
  }
}
