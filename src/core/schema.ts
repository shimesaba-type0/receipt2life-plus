import { z } from "zod";
import { isRealDate } from "./dates";

export const MAX_AMOUNT = 10_000_000;
export const MAX_BATCH = 50;
export const SOURCES = ["receipt", "manual", "voice"] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "YYYY-MM-DD 形式で指定してください(例: 2026-10-11)", abort: true })
  .refine(isRealDate, "実在しない日付です");

export const transactionInputSchema = z
  .strictObject({
    date: isoDate.optional().describe("支出日(YYYY-MM-DD)。省略すると今日(日本時間)。未来の日付は不可"),
    amount: z
      .number({ error: "金額は数値(円)で指定してください" })
      .int("金額は整数(円)で指定してください")
      .min(1, "金額は1円以上で指定してください(返金・マイナスは未対応)")
      .max(MAX_AMOUNT, `金額は${MAX_AMOUNT.toLocaleString("ja-JP")}円以下で指定してください`)
      .describe("金額(円・整数)。レシートの合計額。必須"),
    merchant: z.string().trim().min(1).max(100).optional().describe("店名。読み取れなければ省略(needs_reviewになる)"),
    category: z
      .string()
      .min(1)
      .optional()
      .describe("カテゴリ名。list_categories で取れる既存の名前から選ぶ。決められなければ省略(needs_reviewになる)"),
    account: z.string().min(1).optional().describe("支払方法(口座)名。現金・カード・Suica など。不明なら省略"),
    memo: z.string().max(500).optional().describe("メモ(任意)"),
    source: z
      .enum(SOURCES)
      .default("manual")
      .describe("入力経路。receipt=レシート写真、manual=手入力、voice=音声。省略すると manual"),
    allow_duplicate: z
      .boolean()
      .default(false)
      .describe("true で重複(同日・同額・同じ店)でも強制登録する。同日に同額の別の買い物が実際にあった場合だけ使う"),
  })
  .describe("1件の取引。1枚のレシートにつき1件");

export const addTransactionsSchema = z.object({
  transactions: z
    .array(transactionInputSchema)
    .min(1, "transactions は1件以上必要です")
    .max(MAX_BATCH, `transactions は${MAX_BATCH}件までです`),
});

// 配列の外枠だけを見る。各要素は1件ずつ検証して、エラーを全件まとめて返す
export const addTransactionsEnvelopeSchema = z.object({
  transactions: z.array(z.unknown()).min(1, "transactions は1件以上必要です").max(MAX_BATCH, `transactions は${MAX_BATCH}件までです`),
});

export const listTransactionsSchema = z.strictObject({
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)"),
  to: isoDate.optional().describe("この日以前(YYYY-MM-DD)"),
  category: z.string().min(1).optional().describe("カテゴリ名で絞り込む"),
  limit: z.number().int().min(1).max(500).default(100).describe("最大件数(既定100、最大500)"),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type AddTransactionsInput = z.infer<typeof addTransactionsSchema>;
export type ListTransactionsInput = z.infer<typeof listTransactionsSchema>;

export interface FieldError {
  index?: number;
  field: string;
  message: string;
}

// Zodのエラーを、AIが直して再送できる { index, field, message } に変換する
export function toFieldErrors(error: z.ZodError, index?: number): FieldError[] {
  const out: FieldError[] = [];
  const entry = (field: string, message: string): FieldError => ({ ...(index !== undefined ? { index } : {}), field, message });
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) out.push(entry(key, `${key} は未知の項目です。使える項目名を確認してください`));
    } else {
      const field = issue.path.map(String).join(".") || "input";
      out.push(entry(field, `${field}: ${issue.message}`));
    }
  }
  return out;
}
