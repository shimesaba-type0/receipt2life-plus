// レシートの情報(決済時刻・店の電話/住所・登録番号・担当者・レシート番号・レジ番号・店番号)の、画面側の純関数(DOMに触れない。テストする)
// 正規化と検証の規則は、サーバー(src/core/receipt-details.ts)と同じ。UI は core を import しない決まりなので、ここに持つ
// (tests/ui/receipt-details.test.ts が、サーバーの関数と同じ結果になることを確かめる)

import type { TransactionView } from "../../src/api/contract";

export const MAX_PHONE = 30;
export const MAX_ADDRESS = 200;
export const MAX_RECEIPT_NO = 50;
export const MAX_REGISTER_NO = 30;
export const MAX_STORE_CODE = 30;

// ハイフンに見える文字(全角ハイフン・各種ダッシュ・マイナス・長音記号)
const DASHES = /[‐-―−ー－ｰ]/g;

export function normalizePaidTime(s: string): string {
  return s.normalize("NFKC").trim();
}

export function normalizePhone(s: string): string {
  return s.normalize("NFKC").replace(DASHES, "-").replace(/\s+/g, " ").trim();
}

export function normalizeInvoiceNumber(s: string): string {
  return s.normalize("NFKC").replace(DASHES, "-").replace(/[\s-]+/g, "").toUpperCase();
}

const PAID_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[0-9\-()+ ]+$/;
const INVOICE_RE = /^T\d{13}$/;

export type FieldResult = { ok: true; value: string | null } | { ok: false; error: string };

// 空欄は「値なし」(null)。値があれば正規化して検証する
function optional(raw: string, check: (trimmed: string) => FieldResult): FieldResult {
  if (raw.trim() === "") return { ok: true, value: null };
  return check(raw);
}

export function parsePaidTime(raw: string): FieldResult {
  return optional(raw, (s) => {
    const v = normalizePaidTime(s);
    return PAID_TIME_RE.test(v) ? { ok: true, value: v } : { ok: false, error: "決済時刻は HH:MM 形式(00:00〜23:59)で入力してください。" };
  });
}

export function parsePhone(raw: string): FieldResult {
  return optional(raw, (s) => {
    const v = normalizePhone(s);
    if (v.length > MAX_PHONE) return { ok: false, error: `電話番号は${MAX_PHONE}文字以内にしてください。` };
    if (!PHONE_RE.test(v) || !/\d/.test(v)) return { ok: false, error: "電話番号は数字・ハイフン・括弧・プラス・空白だけで入力してください。" };
    return { ok: true, value: v };
  });
}

export function parseInvoiceNumber(raw: string): FieldResult {
  return optional(raw, (s) => {
    const v = normalizeInvoiceNumber(s);
    return INVOICE_RE.test(v) ? { ok: true, value: v } : { ok: false, error: "事業者登録番号は T と数字13桁で入力してください。" };
  });
}

export function parseText(raw: string, max: number, label: string): FieldResult {
  return optional(raw, (s) => {
    const v = s.trim();
    return v.length > max ? { ok: false, error: `${label}は${max}文字以内にしてください。` } : { ok: true, value: v };
  });
}

// 入力中に出す、登録番号の注意書き。空欄・正しい値は null
export function invoiceHint(raw: string): string | null {
  const r = parseInvoiceNumber(raw);
  return r.ok ? null : r.error;
}

// ---- 表示 ----

export type ShopInfoTx = Pick<TransactionView, "merchant_phone" | "merchant_address" | "invoice_number" | "receipt_no" | "register_no" | "store_code">;

const filled = (v: string | null | undefined): v is string => v != null && v.trim() !== "";

// 「店舗の情報」のブロックを出すか。7項目が全部空なら出さない(決済時刻は日付の隣に出すので数えない)
export function hasShopInfo(tx: ShopInfoTx): boolean {
  return filled(tx.merchant_phone) || filled(tx.merchant_address) || filled(tx.invoice_number) || filled(tx.receipt_no) || filled(tx.register_no) || filled(tx.store_code);
}

// 電話番号の tel: リンク。数字と先頭の + だけにする(ハイフン・括弧・空白は除く)。発信できる形にならなければ null
export function telHref(phone: string | null | undefined): string | null {
  if (!filled(phone)) return null;
  const compact = phone.normalize("NFKC").replace(/[^\d+]/g, "");
  // + は先頭だけ有効
  const digits = compact.replace(/\+/g, "");
  if (digits === "") return null;
  return `tel:${compact.startsWith("+") ? "+" : ""}${digits}`;
}

// 日の詳細の行の「14:32」。時刻なしは null
export function clockLabel(paidTime: string | null | undefined): string | null {
  return paidTime && PAID_TIME_RE.test(paidTime) ? paidTime : null;
}
