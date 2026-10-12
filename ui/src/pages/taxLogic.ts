// 税率・税の内訳・税額のページ(/tax)の純粋な部分(DOMに触れない。テストする)
// 方針はサーバーと同じ: レシートに印字された数字をそのまま記録し、こちらで税額を計算しない。税率の表は持たない
// (選択肢は入力の手間を減らすためだけ。どんな数字でも「その他」で入れられ、選択肢に無い既存の値もそのまま表示・保存する)
// 規則はサーバー(src/core/tax-lines.ts)と同じ値を持つ(UI は core を import しない。tests/ui/tax-logic.test.ts が一致を確かめる)
import type { AmountBasis, DeductionsData, NewTaxLine, TaxLineView, TaxSummaryData, TaxSummaryRow } from "../../../src/api/contract";
import { addMonths, formatYen, monthRange } from "../format";

export const MAX_TAX_RATE = 100;
export const MAX_TAX_LABEL = 20;
export const MAX_TAX_LINES = 10;
const MAX_TAX_YEN = 10_000_000;

// 税率の select の選択肢(よく使う数字だけ。表ではない)。"" は不明、"other" は数字を入力
export const RATE_PRESETS = ["10", "8", "0"] as const;
export const RATE_OTHER = "other";
export const RATE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "未設定" },
  ...RATE_PRESETS.map((v) => ({ value: v, label: `${v}%` })),
  { value: RATE_OTHER, label: "その他(数字を入力)" },
];

export const BASIS_OPTIONS: { value: "" | AmountBasis; label: string }[] = [
  { value: "", label: "不明" },
  { value: "included", label: "税込(内税)" },
  { value: "excluded", label: "税抜(外税)" },
];

// ---- 税率 ----

export type RateParse = { ok: true; value: number | null } | { ok: false; error: string };

export const RATE_MESSAGE = `税率は0〜${MAX_TAX_RATE}の数(%。小数は第3位まで。例: 10、8、0.5)で入力してください。`;

// 入力欄の文字列を税率(%)にする。全角・末尾の「%」は許す。空は null(不明)
export function parseRate(s: string): RateParse {
  const t = s.normalize("NFKC").trim().replace(/%$/, "").trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return { ok: false, error: RATE_MESSAGE };
  const n = Number(t);
  if (n > MAX_TAX_RATE) return { ok: false, error: RATE_MESSAGE };
  return { ok: true, value: n };
}

// 保存されている税率を、select の値とその他の入力欄に分ける(選択肢に無い値は「その他」で表示する)
export function rateFields(rate: number | null): { rate_choice: string; rate_other: string } {
  if (rate === null) return { rate_choice: "", rate_other: "" };
  const s = String(rate);
  return (RATE_PRESETS as readonly string[]).includes(s) ? { rate_choice: s, rate_other: "" } : { rate_choice: RATE_OTHER, rate_other: s };
}

// select と入力欄から税率を読む
export function rateFromFields(f: { rate_choice: string; rate_other: string }): RateParse {
  if (f.rate_choice === "") return { ok: true, value: null };
  return parseRate(f.rate_choice === RATE_OTHER ? f.rate_other : f.rate_choice);
}

// 表示用: 8 → "8%"、0.5 → "0.5%"
export function formatRate(rate: number): string {
  return `${rate}%`;
}

// 明細の行に添える小さな表示(「8% ※」「※」)。どちらも無ければ null
export function itemRateLabel(item: { tax_rate: number | null; tax_label: string | null }): string | null {
  const parts = [item.tax_rate !== null ? formatRate(item.tax_rate) : null, item.tax_label].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function basisLabel(basis: AmountBasis | null): string {
  return basis === "included" ? "税込" : basis === "excluded" ? "税抜" : "";
}

// 印字の記号(前後の空白を除く。空は null)。長すぎればエラー
export function parseTaxLabel(s: string, line?: number): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = s.trim();
  if (t.length > MAX_TAX_LABEL) return { ok: false, error: `${line !== undefined ? `${line}行目: ` : ""}印字の記号は${MAX_TAX_LABEL}文字以内にしてください。` };
  return { ok: true, value: t === "" ? null : t };
}

// ---- 税の内訳の編集 ----

export interface TaxLineRow {
  // 画面の並びの識別(送らない)
  key: string;
  rate_choice: string;
  rate_other: string;
  taxable_amount: string;
  tax_amount: string;
  amount_basis: "" | AmountBasis;
  label: string;
}

export function emptyTaxLineRow(key: string): TaxLineRow {
  return { key, rate_choice: "", rate_other: "", taxable_amount: "", tax_amount: "", amount_basis: "", label: "" };
}

export function taxLineRowsFromView(lines: TaxLineView[]): TaxLineRow[] {
  return lines.map((l) => ({
    key: l.id,
    ...rateFields(l.rate),
    taxable_amount: l.taxable_amount === null ? "" : String(l.taxable_amount),
    tax_amount: l.tax_amount === null ? "" : String(l.tax_amount),
    amount_basis: l.amount_basis ?? "",
    label: l.label ?? "",
  }));
}

export function isBlankTaxLineRow(r: TaxLineRow): boolean {
  return r.rate_choice === "" && r.rate_other.trim() === "" && r.taxable_amount.trim() === "" && r.tax_amount.trim() === "" && r.amount_basis === "" && r.label.trim() === "";
}

// 円の入力(0以上の整数。カンマ可)。空は null
function parseYen(s: string): { ok: true; value: number | null } | { ok: false } {
  const t = s.normalize("NFKC").trim().replace(/[,¥]/g, "");
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  return n <= MAX_TAX_YEN ? { ok: true, value: n } : { ok: false };
}

export type TaxBuild = { ok: true; value: NewTaxLine[] } | { ok: false; error: string };

// 税の内訳の行を API の入力にする。空の行は除く。エラーは「税の内訳の2行目: …」
export function buildTaxLines(rows: TaxLineRow[]): TaxBuild {
  const out: NewTaxLine[] = [];
  const seen = new Map<number, number>();
  let line = 0;
  for (const r of rows) {
    line += 1;
    if (isBlankTaxLineRow(r)) continue;
    const at = `税の内訳の${line}行目: `;
    const rate = rateFromFields(r);
    if (!rate.ok) return { ok: false, error: `${at}${rate.error}` };
    if (rate.value === null) return { ok: false, error: `${at}税率を選んでください(印字どおりの数字)。` };
    const first = seen.get(rate.value);
    if (first !== undefined) return { ok: false, error: `${at}税率 ${formatRate(rate.value)} の行が${first}行目にもあります。税率ごとに1行にしてください。` };
    seen.set(rate.value, line);
    const taxable = parseYen(r.taxable_amount);
    if (!taxable.ok) return { ok: false, error: `${at}対象金額は0以上の整数(円)で入力してください。` };
    const tax = parseYen(r.tax_amount);
    if (!tax.ok) return { ok: false, error: `${at}消費税額は0以上の整数(円)で入力してください。` };
    const label = parseTaxLabel(r.label);
    if (!label.ok) return { ok: false, error: `${at}${label.error}` };
    out.push({ rate: rate.value, taxable_amount: taxable.value, tax_amount: tax.value, amount_basis: r.amount_basis === "" ? null : r.amount_basis, label: label.value });
  }
  if (out.length > MAX_TAX_LINES) return { ok: false, error: `税の内訳は${MAX_TAX_LINES}行までです。` };
  return { ok: true, value: out };
}

// ---- 税額のページ(/tax) ----

export type PeriodKind = "this_month" | "last_month" | "this_year" | "last_year" | "custom";

export const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: "this_month", label: "今月" },
  { value: "last_month", label: "先月" },
  { value: "this_year", label: "今年" },
  { value: "last_year", label: "昨年" },
  { value: "custom", label: "期間指定" },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 期間の種類と今日(JST の YYYY-MM-DD)から、from / to を決める。期間指定は2つの日付(from ≦ to)
export function periodRange(kind: PeriodKind, today: string, custom: { from: string; to: string } = { from: "", to: "" }): { ok: true; from: string; to: string } | { ok: false; error: string } {
  const month = today.slice(0, 7);
  switch (kind) {
    case "this_month":
      return { ok: true, ...monthRange(month) };
    case "last_month":
      return { ok: true, ...monthRange(addMonths(month, -1)) };
    case "this_year":
      return { ok: true, from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case "last_year": {
      const year = Number(today.slice(0, 4)) - 1;
      return { ok: true, from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "custom":
      if (!DATE.test(custom.from) || !DATE.test(custom.to)) return { ok: false, error: "開始日と終了日を入力してください。" };
      if (custom.from > custom.to) return { ok: false, error: "開始日は終了日以前にしてください。" };
      return { ok: true, from: custom.from, to: custom.to };
  }
}

export function taxSummaryQuery(from: string, to: string, groupBy: "rate" | "month"): string {
  const params = new URLSearchParams({ from, to });
  if (groupBy === "month") params.set("group_by", "month");
  return params.toString();
}

// カバレッジの注記。税の内訳が無い支出の件数と金額
export function coverageNote(coverage: TaxSummaryData["coverage"]): string {
  const none = coverage.without_tax_lines;
  if (coverage.transactions.count === 0) return "この期間の支出はありません。";
  if (none.count === 0) return "この期間の支出は、すべて税額の記録があります。";
  return `税額の記録がない支出: ${none.count}件(${formatYen(none.total)})。この表には含まれていません。`;
}

// 表が空か(税の内訳が1行も無い)
export function isEmptySummary(data: Pick<TaxSummaryData, "rows">): boolean {
  return data.rows.length === 0;
}

// 月別の行を、月ごとのまとまりにする(月の古い順。中は税率の高い順のまま)
export function groupRowsByMonth(rows: TaxSummaryRow[]): { month: string; rows: TaxSummaryRow[]; tax_total: number }[] {
  const out: { month: string; rows: TaxSummaryRow[]; tax_total: number }[] = [];
  for (const r of rows) {
    const month = r.month ?? "";
    let group = out.find((g) => g.month === month);
    if (!group) {
      group = { month, rows: [], tax_total: 0 };
      out.push(group);
    }
    group.rows.push(r);
    group.tax_total += r.tax_total;
  }
  return out;
}

// ---- 確定申告の参考(税額のページの上のカード) ----

export interface DeductionRow {
  key: "self_medication" | "medical_with" | "medical_without";
  label: string;
  total: number;
  count: number;
}

// カードに並べる3行(セルフメディケーション、医療費(交通費を含む)、医療費(交通費を含まず))
export function deductionRows(d: DeductionsData): DeductionRow[] {
  return [
    { key: "self_medication", label: "セルフメディケーション税制", ...d.self_medication },
    { key: "medical_with", label: "医療費(交通費を含む)", ...d.medical.including_transport },
    { key: "medical_without", label: "医療費(交通費を含まず)", ...d.medical.excluding_transport },
  ];
}

// 交通費の注記。医療費のうち、大分類が「交通」の支出の合計
export function transportNote(d: DeductionsData): string {
  const t = d.medical.transport;
  if (t.count === 0) return `医療費のうち、大分類が「${d.transport_group}」のカテゴリの支出を交通費とします(この期間はありません)。`;
  return `医療費のうち交通費は ${formatYen(t.total)}(${t.count}件)です。大分類が「${d.transport_group}」のカテゴリの支出を交通費としています。`;
}
