import { summarizeTaxSchema, type TaxGroupBy } from "./report-schema";
import { toFieldErrors, type FieldError } from "./schema";

// 税率別の税額の集計(summarize_tax)。集計するのは、税の内訳(transaction_tax_lines)に入っている印字どおりの数字だけ
// 明細の税率(tax_rate)から税額を計算しない。税の内訳が無い取引は、カバレッジ(coverage.without_tax_lines)として必ず件数と金額を出す

// 対象金額の内訳。税込(included)・税抜(excluded)・不明(amount_basis なし)ごとの対象金額の合計
export interface TaxableBasis {
  included_total: number;
  excluded_total: number;
  unknown_total: number;
}

export interface TaxSummaryRow {
  // 税率(%。印字どおり。8 と 8.0 は同じ)
  rate: number;
  // group_by: "month" のときだけ(YYYY-MM)
  month?: string;
  // その税率の消費税額の合計(印字された税額だけを足す)
  tax_total: number;
  // その税率の対象金額の合計(税込・税抜が混ざりうる。taxable_basis を見る)
  taxable_total: number;
  // その税率の行を持つ取引(レシート)の件数
  receipt_count: number;
  // 税額(tax_amount)が記録されていない行の件数
  missing_tax_amount: number;
  taxable_basis: TaxableBasis;
  // 対象金額に、税込・税抜・不明のうち2種類以上が混ざっている
  mixed_basis: boolean;
}

export interface TaxCoverage {
  // 期間内の全取引
  transactions: { count: number; total: number };
  // 税の内訳がある取引
  with_tax_lines: { count: number; total: number };
  // 税の内訳が無い取引(この集計に含まれていない支出)
  without_tax_lines: { count: number; total: number };
  // 税額(tax_amount)が NULL の税の内訳の行の件数
  lines_missing_tax_amount: number;
  // 対象金額(taxable_amount)が NULL の税の内訳の行の件数
  lines_missing_taxable_amount: number;
}

export type SummarizeTaxResult =
  | {
      ok: true;
      group_by: TaxGroupBy;
      from: string | null;
      to: string | null;
      rows: TaxSummaryRow[];
      totals: { tax_total: number; taxable_total: number; receipt_count: number; taxable_basis: TaxableBasis; mixed_basis: boolean };
      coverage: TaxCoverage;
      message: string;
    }
  | { ok: false; errors: FieldError[] };

interface RawRow {
  rate: number;
  month?: string;
  tax_total: number;
  taxable_total: number;
  receipt_count: number;
  missing_tax_amount: number;
  missing_taxable_amount: number;
  included_total: number;
  excluded_total: number;
  unknown_total: number;
  n_included: number;
  n_excluded: number;
  n_unknown: number;
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const mixed = (counts: number[]) => counts.filter((n) => n > 0).length >= 2;

export async function summarizeTax(db: D1Database, input: unknown): Promise<SummarizeTaxResult> {
  const parsed = summarizeTaxSchema.safeParse(input ?? {});
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
  const byMonth = groupBy === "month";
  const monthExpr = "substr(t.date, 1, 7)";

  const [rowsResult, distinct, coverage] = await Promise.all([
    db
      .prepare(
        `SELECT l.rate AS rate${byMonth ? `, ${monthExpr} AS month` : ""},
                COALESCE(SUM(l.tax_amount), 0) AS tax_total,
                COALESCE(SUM(l.taxable_amount), 0) AS taxable_total,
                COUNT(DISTINCT l.transaction_id) AS receipt_count,
                SUM(CASE WHEN l.tax_amount IS NULL THEN 1 ELSE 0 END) AS missing_tax_amount,
                SUM(CASE WHEN l.taxable_amount IS NULL THEN 1 ELSE 0 END) AS missing_taxable_amount,
                COALESCE(SUM(CASE WHEN l.amount_basis = 'included' THEN l.taxable_amount END), 0) AS included_total,
                COALESCE(SUM(CASE WHEN l.amount_basis = 'excluded' THEN l.taxable_amount END), 0) AS excluded_total,
                COALESCE(SUM(CASE WHEN l.amount_basis IS NULL THEN l.taxable_amount END), 0) AS unknown_total,
                SUM(CASE WHEN l.amount_basis = 'included' AND l.taxable_amount IS NOT NULL THEN 1 ELSE 0 END) AS n_included,
                SUM(CASE WHEN l.amount_basis = 'excluded' AND l.taxable_amount IS NOT NULL THEN 1 ELSE 0 END) AS n_excluded,
                SUM(CASE WHEN l.amount_basis IS NULL AND l.taxable_amount IS NOT NULL THEN 1 ELSE 0 END) AS n_unknown
         FROM transaction_tax_lines l JOIN transactions t ON t.id = l.transaction_id
         ${where}
         GROUP BY l.rate${byMonth ? `, ${monthExpr}` : ""}`,
      )
      .bind(...params)
      .all<RawRow>(),
    db
      .prepare(`SELECT COUNT(DISTINCT l.transaction_id) AS n FROM transaction_tax_lines l JOIN transactions t ON t.id = l.transaction_id ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total,
                COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM transaction_tax_lines x WHERE x.transaction_id = t.id) THEN 1 ELSE 0 END), 0) AS with_count,
                COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM transaction_tax_lines x WHERE x.transaction_id = t.id) THEN t.amount ELSE 0 END), 0) AS with_total
         FROM transactions t ${where}`,
      )
      .bind(...params)
      .first<{ count: number; total: number; with_count: number; with_total: number }>(),
  ]);

  const raw = rowsResult.results;
  const rows: TaxSummaryRow[] = raw.map((r) => ({
    rate: r.rate,
    ...(byMonth && r.month !== undefined ? { month: r.month } : {}),
    tax_total: r.tax_total,
    taxable_total: r.taxable_total,
    receipt_count: r.receipt_count,
    missing_tax_amount: r.missing_tax_amount,
    taxable_basis: { included_total: r.included_total, excluded_total: r.excluded_total, unknown_total: r.unknown_total },
    mixed_basis: mixed([r.n_included, r.n_excluded, r.n_unknown]),
  }));
  // 税率の高い順。月別は月の古い順 → 税率の高い順
  rows.sort((a, b) => (a.month ?? "").localeCompare(b.month ?? "") || b.rate - a.rate);

  const sum = (f: (r: RawRow) => number) => raw.reduce((s, r) => s + f(r), 0);
  const totals = {
    tax_total: sum((r) => r.tax_total),
    taxable_total: sum((r) => r.taxable_total),
    receipt_count: distinct?.n ?? 0,
    taxable_basis: { included_total: sum((r) => r.included_total), excluded_total: sum((r) => r.excluded_total), unknown_total: sum((r) => r.unknown_total) },
    mixed_basis: mixed([sum((r) => r.n_included), sum((r) => r.n_excluded), sum((r) => r.n_unknown)]),
  };
  const all = { count: coverage?.count ?? 0, total: coverage?.total ?? 0 };
  const withLines = { count: coverage?.with_count ?? 0, total: coverage?.with_total ?? 0 };
  const cov: TaxCoverage = {
    transactions: all,
    with_tax_lines: withLines,
    without_tax_lines: { count: all.count - withLines.count, total: all.total - withLines.total },
    lines_missing_tax_amount: sum((r) => r.missing_tax_amount),
    lines_missing_taxable_amount: sum((r) => r.missing_taxable_amount),
  };

  return { ok: true, group_by: groupBy, from: from ?? null, to: to ?? null, rows, totals, coverage: cov, message: buildMessage(from, to, rows, totals, cov, byMonth) };
}

function buildMessage(
  from: string | undefined,
  to: string | undefined,
  rows: TaxSummaryRow[],
  totals: { tax_total: number; mixed_basis: boolean },
  cov: TaxCoverage,
  byMonth: boolean,
): string {
  const range = !from && !to ? "全期間" : `${from ?? ""}〜${to ?? ""}`;
  if (cov.transactions.count === 0) return `${range}: 記録された支出はありません`;
  const parts: string[] = [];
  if (rows.length === 0) {
    parts.push(`${range}: 税の内訳(tax_lines)が記録された支出はありません`);
  } else {
    // 月別でも、要約は税率ごとにまとめる
    const byRate = new Map<number, { tax: number; count: number }>();
    for (const r of rows) {
      const cur = byRate.get(r.rate) ?? { tax: 0, count: 0 };
      byRate.set(r.rate, { tax: cur.tax + r.tax_total, count: cur.count + r.receipt_count });
    }
    const list = [...byRate].sort((a, b) => b[0] - a[0]).map(([rate, v]) => `${rate}% ${yen(v.tax)}(${v.count}件)`);
    parts.push(`${range}: 税額の合計 ${yen(totals.tax_total)}(${list.join("、")})${byMonth ? "。月別の行は rows" : ""}`);
  }
  if (cov.without_tax_lines.count > 0) {
    parts.push(`税の内訳が記録されていない支出が${cov.without_tax_lines.count}件(${yen(cov.without_tax_lines.total)})あり、この集計に含まれていません`);
  }
  if (cov.lines_missing_tax_amount > 0) parts.push(`税額が記録されていない内訳の行が${cov.lines_missing_tax_amount}件あります`);
  if (totals.mixed_basis) parts.push("対象金額に税込と税抜(または不明)が混ざっています。taxable_basis の内訳を見てください");
  parts.push("レシートに印字された数字の合計で、記録した範囲の集計です");
  return parts.join("。");
}
