import { z } from "zod";
import { isoDate, MAX_AMOUNT, SOURCES } from "./schema";

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
});

const EDITABLE = ["date", "amount", "merchant", "category", "account", "memo", "source"] as const;

export const updateTransactionSchema = updateTransactionFieldsSchema.refine(
  (v) => EDITABLE.some((k) => v[k] !== undefined),
  { message: `変更する項目を1つ以上指定してください(${EDITABLE.join("、")})`, path: ["input"] },
);

export const deleteTransactionSchema = z.strictObject({ id });

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type DeleteTransactionInput = z.infer<typeof deleteTransactionSchema>;
