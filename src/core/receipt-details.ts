import { z } from "zod";

// レシートから読み取れる情報(取引の任意の列。migration 0006)。検証と正規化はここの1か所に置く
// (add_transactions / update_transaction / API / JSONL の取り込みは、同じスキーマを通る)
// UI は core を import しない決まりなので、同じ規則を ui/src/receiptDetails.ts にも持つ(tests/ui/receipt-details.test.ts が一致を確かめる)

export const MAX_PHONE = 30;
export const MAX_ADDRESS = 200;
export const MAX_CLERK = 50;
export const MAX_RECEIPT_NO = 50;
export const MAX_REGISTER_NO = 30;
export const MAX_STORE_CODE = 30;

export const RECEIPT_DETAIL_KEYS = ["paid_time", "merchant_phone", "merchant_address", "invoice_number", "clerk_name", "receipt_no", "register_no", "store_code"] as const;
export type ReceiptDetailKey = (typeof RECEIPT_DETAIL_KEYS)[number];

export const PAID_TIME_MESSAGE = "決済時刻は HH:MM 形式(00:00〜23:59、日本時間。例: 14:32)で指定してください";
export const PHONE_CHARS_MESSAGE = "電話番号は数字・ハイフン・括弧・プラス・空白だけで指定してください(例: 03-0000-0000)";
export const INVOICE_MESSAGE = "T と数字13桁で入力してください(例: T0000000000000)";

// ハイフンに見える文字(全角ハイフン・各種ダッシュ・マイナス・長音記号)
const DASHES = /[‐-―−ー－ｰ]/g;

// 時刻: 前後の空白を除き、全角数字・全角コロンは半角にする。形式の検証は paidTimeField が行う
export function normalizePaidTime(s: string): string {
  return s.normalize("NFKC").trim();
}

// 電話番号: 全角は半角に、ハイフン類は "-" に、空白は1つにして前後を除く。使える文字の検証は merchantPhoneField が行う
export function normalizePhone(s: string): string {
  return s.normalize("NFKC").replace(DASHES, "-").replace(/\s+/g, " ").trim();
}

// 電話番号の比較・検索用: 数字だけ
export function phoneDigits(s: string): string {
  return s.normalize("NFKC").replace(/\D/g, "");
}

// 登録番号: 全角は半角に、空白・ハイフン類を除き、英字は大文字にする。T と数字13桁かの検証は invoiceNumberField が行う
export function normalizeInvoiceNumber(s: string): string {
  return s.normalize("NFKC").replace(DASHES, "-").replace(/[\s-]+/g, "").toUpperCase();
}

const PAID_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[0-9\-()+ ]+$/;
const INVOICE_RE = /^T\d{13}$/;

export const paidTimeField = z
  .string({ error: PAID_TIME_MESSAGE })
  .overwrite(normalizePaidTime)
  .regex(PAID_TIME_RE, PAID_TIME_MESSAGE);

export const merchantPhoneField = z
  .string({ error: PHONE_CHARS_MESSAGE })
  .overwrite(normalizePhone)
  .min(1, "電話番号が空です(空にするときは null を指定してください)")
  .max(MAX_PHONE, `電話番号は${MAX_PHONE}文字以内にしてください`)
  .regex(PHONE_RE, PHONE_CHARS_MESSAGE)
  .refine((v) => /\d/.test(v), "電話番号に数字がありません");

export const merchantAddressField = z
  .string({ error: "住所は文字列で指定してください" })
  .trim()
  .min(1, "住所が空です(空にするときは null を指定してください)")
  .max(MAX_ADDRESS, `住所は${MAX_ADDRESS}文字以内にしてください`);

export const invoiceNumberField = z.string({ error: INVOICE_MESSAGE }).overwrite(normalizeInvoiceNumber).regex(INVOICE_RE, INVOICE_MESSAGE);

export const clerkNameField = z
  .string({ error: "担当者名は文字列で指定してください" })
  .trim()
  .min(1, "担当者名が空です(空にするときは null を指定してください)")
  .max(MAX_CLERK, `担当者名は${MAX_CLERK}文字以内にしてください`);

export const receiptNoField = z
  .string({ error: "レシート番号は文字列で指定してください" })
  .trim()
  .min(1, "レシート番号が空です(空にするときは null を指定してください)")
  .max(MAX_RECEIPT_NO, `レシート番号は${MAX_RECEIPT_NO}文字以内にしてください`);

export const registerNoField = z
  .string({ error: "レジ番号は文字列で指定してください" })
  .trim()
  .min(1, "レジ番号が空です(空にするときは null を指定してください)")
  .max(MAX_REGISTER_NO, `レジ番号は${MAX_REGISTER_NO}文字以内にしてください`);

export const storeCodeField = z
  .string({ error: "店番号は文字列で指定してください" })
  .trim()
  .min(1, "店番号が空です(空にするときは null を指定してください)")
  .max(MAX_STORE_CODE, `店番号は${MAX_STORE_CODE}文字以内にしてください`);

// 取引に足す項目(すべて任意・null可)。add_transactions の各取引に展開する。null は「値なし」(登録では省略と同じ)
export const receiptDetailShape = {
  paid_time: paidTimeField
    .nullable()
    .optional()
    .describe("決済時刻(日本時間、HH:MM、00:00〜23:59。例: 14:32)。レシートに時刻の印字があるときだけ。日付は date。印字が無ければ省略"),
  merchant_phone: merchantPhoneField
    .nullable()
    .optional()
    .describe(`店の電話番号(数字・ハイフン・括弧・プラス・空白のみ、${MAX_PHONE}文字まで。全角数字は半角にして保存する)。レシートに印字があるときだけ。印字が無ければ省略`),
  merchant_address: merchantAddressField
    .nullable()
    .optional()
    .describe(`店の住所(${MAX_ADDRESS}文字まで)。レシートに印字があるときだけ。印字が無ければ省略`),
  invoice_number: invoiceNumberField
    .nullable()
    .optional()
    .describe(
      "適格請求書発行事業者の登録番号(T + 数字13桁。例: T0000000000000)。レシートの「登録番号」「事業者番号」の印字。全角・小文字の t・ハイフンや空白入りでも受け付け、正規化して保存する。T と数字13桁にならなければエラー。印字が無ければ省略",
    ),
  clerk_name: clerkNameField
    .nullable()
    .optional()
    .describe(`対応した店員の名前(レシートの「担当」「責任者」「レジ」などの印字。${MAX_CLERK}文字まで)。印字が無ければ省略`),
  receipt_no: receiptNoField
    .nullable()
    .optional()
    .describe(`レシート番号・伝票番号(例: P20261003152814。${MAX_RECEIPT_NO}文字まで)。印字が無ければ省略`),
  register_no: registerNoField
    .nullable()
    .optional()
    .describe(`レジ番号(例: 0005。「レジ」の後ろの番号。${MAX_REGISTER_NO}文字まで)。印字が無ければ省略。伝票番号 receipt_no とは別`),
  store_code: storeCodeField
    .nullable()
    .optional()
    .describe(`店番号・店舗コード(例: 007832。${MAX_STORE_CODE}文字まで)。印字が無ければ省略`),
};

// update_transaction 用: 渡さなければ変えない、null で空にする
export const receiptDetailPatchShape = {
  paid_time: paidTimeField.nullable().optional().describe("決済時刻(日本時間、HH:MM、00:00〜23:59。例: 14:32)。null で空にする"),
  merchant_phone: merchantPhoneField
    .nullable()
    .optional()
    .describe(`店の電話番号(数字・ハイフン・括弧・プラス・空白のみ、${MAX_PHONE}文字まで)。null で空にする`),
  merchant_address: merchantAddressField.nullable().optional().describe(`店の住所(${MAX_ADDRESS}文字まで)。null で空にする`),
  invoice_number: invoiceNumberField
    .nullable()
    .optional()
    .describe("適格請求書発行事業者の登録番号(T + 数字13桁。全角・小文字・ハイフンや空白入りは正規化する)。null で空にする"),
  clerk_name: clerkNameField.nullable().optional().describe(`対応した店員の名前(${MAX_CLERK}文字まで)。null で空にする`),
  receipt_no: receiptNoField.nullable().optional().describe(`レシート番号・伝票番号(${MAX_RECEIPT_NO}文字まで)。null で空にする`),
  register_no: registerNoField.nullable().optional().describe(`レジ番号(例: 0005。${MAX_REGISTER_NO}文字まで)。null で空にする`),
  store_code: storeCodeField.nullable().optional().describe(`店番号・店舗コード(例: 007832。${MAX_STORE_CODE}文字まで)。null で空にする`),
};

// 保存・返却用の形(未指定は null)
export interface ReceiptDetails {
  paid_time: string | null;
  merchant_phone: string | null;
  merchant_address: string | null;
  invoice_number: string | null;
  clerk_name: string | null;
  receipt_no: string | null;
  register_no: string | null;
  store_code: string | null;
}

export function detailsOf(input: { [K in ReceiptDetailKey]?: string | null | undefined }): ReceiptDetails {
  return {
    paid_time: input.paid_time ?? null,
    merchant_phone: input.merchant_phone ?? null,
    merchant_address: input.merchant_address ?? null,
    invoice_number: input.invoice_number ?? null,
    clerk_name: input.clerk_name ?? null,
    receipt_no: input.receipt_no ?? null,
    register_no: input.register_no ?? null,
    store_code: input.store_code ?? null,
  };
}
