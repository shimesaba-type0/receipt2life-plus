// 明細ページ(/tx/:id)の純粋な部分(DOMに触れない。テストする)
import type { FieldError, ItemView, NewItem, TaxFlag, TransactionPatch, TransactionView } from "../../../src/api/contract";
import { formatYen } from "../format";
import { parseTaxFlagField } from "./dayLogic";

export const MAX_ITEMS = 50;
export const MAX_ITEM_NAME = 100;
export const MAX_ITEM_AMOUNT = 10_000_000;

// ---- 金額 ----

// 入力欄の文字列を整数(円)にする。マイナス可。空・小数・桁あふれは null
export function parseAmount(s: string): number | null {
  const t = s.trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

// 符号つきの金額。マイナスは「-¥80」
export function formatSignedYen(n: number): string {
  return n < 0 ? `-${formatYen(-n)}` : formatYen(n);
}

// ---- 実効値(行が null なら取引の値) ----

export function effectiveCategory(item: Pick<ItemView, "category">, tx: Pick<TransactionView, "category">): string | null {
  return item.category ?? tx.category ?? null;
}

export function effectiveTaxFlag(item: Pick<ItemView, "tax_flag">, tx: Pick<TransactionView, "tax_flag">): TaxFlag | null {
  return item.tax_flag ?? tx.tax_flag ?? null;
}

export function itemsTotal(items: Pick<ItemView, "amount">[]): number {
  return items.reduce((sum, it) => sum + it.amount, 0);
}

// 見るだけのビューの小計の表示
export function viewTotalsLabel(tx: Pick<TransactionView, "amount" | "items">): { total: string; matches: boolean; note: string } {
  const total = itemsTotal(tx.items);
  const matches = total === tx.amount;
  return {
    total: `明細の合計 ${formatSignedYen(total)}`,
    matches,
    note: matches ? "レシートの合計と一致" : `レシートの合計 ${formatYen(tx.amount)} と ${formatSignedYen(total - tx.amount)} ずれています`,
  };
}

// 日の一覧の行のサブ表示。明細が無ければ null。「3点」と、取引のカテゴリ以外の実効カテゴリの種類が n あれば「ほかn」
export function dayItemsSub(tx: Pick<TransactionView, "items" | "category">): { count: string; others: string | null } | null {
  if (tx.items.length === 0) return null;
  const others = new Set<string>();
  for (const it of tx.items) {
    const c = effectiveCategory(it, tx);
    if (c && c !== tx.category) others.add(c);
  }
  return { count: `${tx.items.length}点`, others: others.size > 0 ? `ほか${others.size}` : null };
}

// ---- 編集フォーム ----

export interface TxFormValues {
  date: string;
  amount: string;
  merchant: string;
  category: string;
  account: string;
  memo: string;
  // "" がフラグなし
  tax_flag: string;
}

export interface ItemRow {
  // 画面の並びの識別(送らない)
  key: string;
  name: string;
  amount: string;
  // "" は取引に従う
  category: string;
  tax_flag: string;
  memo: string;
}

export function txFormFromView(tx: TransactionView): TxFormValues {
  return { date: tx.date, amount: String(tx.amount), merchant: tx.merchant ?? "", category: tx.category ?? "", account: tx.account ?? "", memo: tx.memo ?? "", tax_flag: tx.tax_flag ?? "" };
}

export function itemRowsFromView(items: ItemView[]): ItemRow[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((it) => ({ key: it.id, name: it.name, amount: String(it.amount), category: it.category ?? "", tax_flag: it.tax_flag ?? "", memo: it.memo ?? "" }));
}

export function emptyItemRow(key: string): ItemRow {
  return { key, name: "", amount: "", category: "", tax_flag: "", memo: "" };
}

// 追加しただけで何も入れていない行(送らない)
export function isBlankRow(r: ItemRow): boolean {
  return r.name.trim() === "" && r.amount.trim() === "" && r.memo.trim() === "";
}

export interface TotalsCheck {
  rowCount: number;
  itemsTotal: number;
  // 金額が読めないときは null
  receiptTotal: number | null;
  diff: number | null;
  // 読めない金額の行がある
  hasInvalid: boolean;
  // 明細なし、または合計が一致している(保存してよい合計)
  ok: boolean;
  label: string;
}

// 明細の合計とレシートの合計の検証。空の行は数えない
export function checkTotals(rows: ItemRow[], amountText: string): TotalsCheck {
  const used = rows.filter((r) => !isBlankRow(r));
  let total = 0;
  let hasInvalid = false;
  for (const r of used) {
    const n = parseAmount(r.amount);
    if (n === null || n === 0) hasInvalid = true;
    else total += n;
  }
  const receipt = parseAmount(amountText);
  if (used.length === 0) return { rowCount: 0, itemsTotal: 0, receiptTotal: receipt, diff: null, hasInvalid: false, ok: true, label: "明細はありません(1行の支出です)" };
  if (receipt === null) {
    return { rowCount: used.length, itemsTotal: total, receiptTotal: null, diff: null, hasInvalid, ok: false, label: `明細の合計 ${formatSignedYen(total)} / レシートの合計が入力されていません` };
  }
  const diff = total - receipt;
  const base = `明細の合計 ${formatSignedYen(total)} / レシートの合計 ${formatYen(receipt)}`;
  return {
    rowCount: used.length,
    itemsTotal: total,
    receiptTotal: receipt,
    diff,
    hasInvalid,
    ok: diff === 0 && !hasInvalid,
    label: diff === 0 ? `${base}(一致)` : `${base}(差 ${formatSignedYen(diff)})`,
  };
}

// 「合計に合わせる」で、取引の金額を明細の合計にできるか(合計が正で、読めない行が無いとき)
export function canMatchTotal(check: TotalsCheck): boolean {
  return check.rowCount > 0 && !check.hasInvalid && check.itemsTotal > 0 && check.receiptTotal !== check.itemsTotal;
}

export function matchTotal(form: TxFormValues, rows: ItemRow[]): TxFormValues {
  const check = checkTotals(rows, form.amount);
  return canMatchTotal(check) ? { ...form, amount: String(check.itemsTotal) } : form;
}

// 一括: 取引のカテゴリにして、全行のカテゴリを空(取引に従う)にする
export function applyBulkCategory(form: TxFormValues, rows: ItemRow[], category: string): { form: TxFormValues; rows: ItemRow[] } {
  return { form: { ...form, category }, rows: rows.map((r) => ({ ...r, category: "" })) };
}

export function applyBulkTaxFlag(form: TxFormValues, rows: ItemRow[], taxFlag: string): { form: TxFormValues; rows: ItemRow[] } {
  return { form: { ...form, tax_flag: taxFlag }, rows: rows.map((r) => ({ ...r, tax_flag: "" })) };
}

const nullable = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export type BuildResult<T> = { ok: true; value: T } | { ok: false; error: string };

// 明細の行を API の入力にする。空の行は除く。エラーは「3行目: …」
export function buildItems(rows: ItemRow[]): BuildResult<NewItem[]> {
  const out: NewItem[] = [];
  let line = 0;
  for (const r of rows) {
    line += 1;
    if (isBlankRow(r)) continue;
    const name = r.name.trim();
    if (name === "") return { ok: false, error: `${line}行目: 品名を入力してください。` };
    if (name.length > MAX_ITEM_NAME) return { ok: false, error: `${line}行目: 品名は${MAX_ITEM_NAME}文字以内にしてください。` };
    const amount = parseAmount(r.amount);
    if (amount === null) return { ok: false, error: `${line}行目: 金額は整数(円)で入力してください。` };
    if (amount === 0) return { ok: false, error: `${line}行目: 金額は0にできません(値引きはマイナスで入力します)。` };
    if (Math.abs(amount) > MAX_ITEM_AMOUNT) return { ok: false, error: `${line}行目: 金額は${MAX_ITEM_AMOUNT.toLocaleString("ja-JP")}円以下にしてください。` };
    out.push({ name, amount, category: nullable(r.category), tax_flag: parseTaxFlagField(r.tax_flag), memo: nullable(r.memo) });
  }
  if (out.length > MAX_ITEMS) return { ok: false, error: `明細は${MAX_ITEMS}行までです。` };
  return { ok: true, value: out };
}

// 編集フォーム → PATCH の入力。明細が0行のとき、元々明細があれば [](全消し)、なければ items を省略する
export function buildPatch(form: TxFormValues, rows: ItemRow[], hadItems: boolean): BuildResult<TransactionPatch> {
  const amount = parseAmount(form.amount);
  if (amount === null) return { ok: false, error: "金額は整数(円)で入力してください。" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return { ok: false, error: "日付を入力してください。" };
  const items = buildItems(rows);
  if (!items.ok) return items;
  const patch: TransactionPatch = {
    date: form.date,
    amount,
    merchant: nullable(form.merchant),
    category: nullable(form.category),
    account: nullable(form.account),
    memo: nullable(form.memo),
    tax_flag: parseTaxFlagField(form.tax_flag),
  };
  if (items.value.length > 0) {
    const total = itemsTotal(items.value);
    if (total !== amount) return { ok: false, error: `明細の合計(${formatSignedYen(total)})がレシートの合計(${formatYen(amount)})と合っていません。` };
    patch.items = items.value;
  } else if (hadItems) {
    patch.items = [];
  }
  return { ok: true, value: patch };
}

// ---- 削除 ----

export interface DeleteCounts {
  items: number;
  photos: number;
  links: number;
}

export function deleteSummary(counts: DeleteCounts): string {
  return `明細${counts.items}行・写真${counts.photos}枚・リンク${counts.links}件`;
}

// 写真があるときは、写真もいっしょに削除することへの同意(チェック)が要る
export function canConfirmDelete(counts: DeleteCounts, withPhotos: boolean): boolean {
  return counts.photos === 0 || withPhotos;
}

// DELETE に付けるか(写真があり、同意したときだけ ?delete_photos=1)
export function shouldDeletePhotos(counts: DeleteCounts, withPhotos: boolean): boolean {
  return counts.photos > 0 && withPhotos;
}

// ---- エラー ----

// GET /api/transactions/:id の 404(「その id のものはありません」)か
export function isNotFoundErrors(errors: FieldError[]): boolean {
  return errors.some((e) => e.field === "id" && /はありません/.test(e.message));
}

export function errorsMessage(errors: FieldError[]): string {
  return errors.map((e) => e.message).join(" / ") || "うまくいきませんでした。";
}
