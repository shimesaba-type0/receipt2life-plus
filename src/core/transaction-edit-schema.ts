import { z } from "zod";
import { receiptDetailPatchShape, RECEIPT_DETAIL_KEYS } from "./receipt-details";
import { isoDate, itemsSchema, MAX_AMOUNT, MAX_ITEMS, SOURCES } from "./schema";
import { TAX_FLAG_DESCRIPTION, taxFlagSchema } from "./tax-flags";

const id = z.string().min(1, "id は必須です").describe("対象の取引ID。list_transactions で確認する");

// 更新の入力定義。MCPの入力定義には updateTransactionFieldsSchema.shape を使い、検証は updateTransactionSchema で行う
export const updateTransactionFieldsSchema = z.strictObject({
  id,
  date: isoDate.optional().describe("支出日(YYYY-MM-DD)。未来の日付は不可。空にはできない"),
  amount: z
    .number({ error: "金額は数値(円)で指定してください" })
    .int("金額は整数(円)で指定してください")
    .min(1, "金額は1円以上で指定してください(返金・マイナスは未対応)")
    .max(MAX_AMOUNT, `金額は${MAX_AMOUNT.toLocaleString("ja-JP")}円以下で指定してください`)
    .optional()
    .describe("金額(円・整数)。空にはできない"),
  merchant: z.string().trim().min(1).max(100).nullable().optional().describe("店名。null で空にする"),
  category: z.string().min(1).nullable().optional().describe("カテゴリ名。既存の名前から選ぶ。null で空にする"),
  account: z.string().min(1).nullable().optional().describe("支払方法(口座)名。既存の名前から選ぶ。null で空にする"),
  memo: z.string().max(500).nullable().optional().describe("メモ。null で空にする"),
  source: z.enum(SOURCES).optional().describe("入力経路。receipt / manual / voice"),
  ...receiptDetailPatchShape,
  tax_flag: taxFlagSchema.nullable().optional().describe(`${TAX_FLAG_DESCRIPTION}null で解除する`),
  items: itemsSchema
    .nullable()
    .optional()
    .describe(
      `明細(レシートの行)を丸ごと置き換える。省略または null で明細は変えない。[] で明細を全部消す(明細なしの取引に戻す)。各行は name(品名)・amount(円・整数。値引きはマイナス)・category / tax_flag(省略で取引の値に従う)・memo。${MAX_ITEMS}行まで。明細がある取引は、明細の合計 = 取引の amount でなければエラー(amount だけを変えるときも、今の明細の合計と合わせる)`,
    ),
});

const EDITABLE = ["date", "amount", "merchant", "category", "account", "memo", "source", ...RECEIPT_DETAIL_KEYS, "tax_flag", "items"] as const;

// items は null も「変えない」なので、変更に数えない
export const updateTransactionSchema = updateTransactionFieldsSchema.refine(
  (v) => EDITABLE.some((k) => (k === "items" ? v.items != null : v[k] !== undefined)),
  { message: `変更する項目を1つ以上指定してください(${EDITABLE.join("、")})`, path: ["input"] },
);

export const deleteTransactionSchema = z.strictObject({
  id,
  delete_photos: z
    .boolean()
    .default(false)
    .describe("true で、取引に紐づく写真もいっしょに削除する(写真の実体も消え、取り消せない)。省略または false なら、写真が紐づく取引は削除せずエラーにする"),
});

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type DeleteTransactionInput = z.infer<typeof deleteTransactionSchema>;
