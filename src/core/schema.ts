import { z } from "zod";
import { isRealDate } from "./dates";
import { receiptDetailShape } from "./receipt-details";
import { TAX_FLAG_DESCRIPTION, TAX_FLAG_FILTER_DESCRIPTION, TAX_FLAG_FILTERS, taxFlagSchema } from "./tax-flags";
import { itemTaxShape, TAX_LINES_DESCRIPTION, taxLinesSchema } from "./tax-lines";

export const MAX_AMOUNT = 10_000_000;
export const MAX_BATCH = 50;
export const SOURCES = ["receipt", "manual", "voice"] as const;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "YYYY-MM-DD 形式で指定してください(例: 2026-10-11)", abort: true })
  .refine(isRealDate, "実在しない日付です");

export const MAX_ITEMS = 50;
export const MAX_ITEM_NAME = 100;

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

// 明細(レシートの1行)。行の金額はマイナス(値引き)も可。0円は不可
export const itemInputSchema = z
  .strictObject({
    name: z
      .string({ error: "品名(name)は文字列で指定してください" })
      .trim()
      .min(1, "品名(name)は必須です")
      .max(MAX_ITEM_NAME, `品名は${MAX_ITEM_NAME}文字以内にしてください`)
      .describe(`品名。レシートの行の表記のまま(${MAX_ITEM_NAME}文字まで)。必須`),
    amount: z
      .number({ error: "行の金額は数値(円)で指定してください" })
      .int("行の金額は整数(円)で指定してください")
      .min(-MAX_AMOUNT, `行の金額は絶対値で${MAX_AMOUNT.toLocaleString("ja-JP")}円以下にしてください`)
      .max(MAX_AMOUNT, `行の金額は絶対値で${MAX_AMOUNT.toLocaleString("ja-JP")}円以下にしてください`)
      .refine((v) => v !== 0, "行の金額に0円は使えません(0円の行は省く)")
      .describe("行の金額(円・整数)。値引き・割引はマイナスの行にする(例: -100)。0は不可。必須"),
    category: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe("この行だけのカテゴリ名(既存の名前から選ぶ)。省略または null なら取引の category に従う。取引と違うカテゴリの行にだけ付ける"),
    tax_flag: taxFlagSchema
      .nullable()
      .optional()
      .describe("この行だけの税金の控除用フラグ(medical / self_medication / donation)。省略または null なら取引の tax_flag に従う。消費税の税率(tax_rate)とは別物"),
    memo: z.string().max(500).nullable().optional().describe("行のメモ(任意)"),
    ...itemTaxShape,
  })
  .describe("明細の1行(品名と金額)");

export const itemsSchema = z.array(itemInputSchema).max(MAX_ITEMS, `items(明細)は1取引あたり${MAX_ITEMS}行までです`);

export type ItemInput = z.infer<typeof itemInputSchema>;

const ITEMS_DESCRIPTION = [
  "明細(レシートの行)。任意。レシート写真を見て、品名・金額の行をそのまま上から順に入れる。",
  "値引き・割引はマイナスの行にする。明細の amount の合計は、取引の amount(支払総額)と一致させる(合わなければ全体がエラーになり、差額が返る)。",
  "行ごとにカテゴリ・税金のフラグを変えられる(例: ドラッグストアのレシートで、薬の行だけ tax_flag: self_medication、日用品の行は category: 日用品)。全部同じカテゴリなら、取引の category だけを付けて、行の category は省く。",
  `1取引あたり${MAX_ITEMS}行まで。消費税の行・小計・合計・お釣りの行は入れない(税込みの金額で行を作るか、外税なら「消費税」の行を1つ足して合計を合わせる)`,
].join("");

// 明細の合計が取引の金額と合わなければ、理由の文(項目名なし)を返す。明細が無ければ検証しない
export function itemsTotalMismatch(amount: number, items: readonly { amount: number }[]): string | null {
  if (items.length === 0) return null;
  const sum = items.reduce((s, i) => s + i.amount, 0);
  if (sum === amount) return null;
  const diff = amount - sum;
  const direction = diff > 0 ? `明細が${yen(diff)}足りません` : `明細が${yen(-diff)}多すぎます`;
  return `明細の合計(${yen(sum)})が金額 amount(${yen(amount)})と一致しません。差額は${yen(Math.abs(diff))}で、${direction}。値引きはマイナスの行にして、合計を amount に合わせてください`;
}

export const transactionInputSchema = z
  .strictObject({
    date: isoDate.optional().describe("支出日(YYYY-MM-DD)。省略すると今日(日本時間)。未来の日付は不可"),
    amount: z
      .number({ error: "金額は数値(円)で指定してください" })
      .int("金額は整数(円)で指定してください")
      .min(1, "金額は1円以上で指定してください(返金・マイナスは未対応)")
      .max(MAX_AMOUNT, `金額は${MAX_AMOUNT.toLocaleString("ja-JP")}円以下で指定してください`)
      .describe("金額(円・整数)。レシートの合計額(支払総額)。必須"),
    merchant: z.string().trim().min(1).max(100).optional().describe("店名。読み取れなければ省略(needs_reviewになる)"),
    category: z
      .string()
      .min(1)
      .optional()
      .describe(
        "カテゴリ名。list_categories で取れる既存の名前から選ぶ。明細があるときは、行に category が無い行のカテゴリになる。決められなければ省略(同じ店の直近の支出にカテゴリがあれば、それを引き継ぐ。無ければ needs_review になる)",
      ),
    account: z.string().min(1).optional().describe("支払方法(口座)名。現金・カード・Suica など。不明なら省略"),
    memo: z.string().max(500).optional().describe("メモ(任意)。レシートのどの項目(口座・レジ番号・伝票番号・店番号・電話・住所・登録番号・担当者・税の内訳)にも当てはまらない補足だけ。支払方法などは入れない"),
    ...receiptDetailShape,
    tax_flag: taxFlagSchema.nullable().optional().describe(TAX_FLAG_DESCRIPTION),
    items: itemsSchema.optional().describe(ITEMS_DESCRIPTION),
    tax_lines: taxLinesSchema.optional().describe(TAX_LINES_DESCRIPTION),
    source: z
      .enum(SOURCES)
      .default("manual")
      .describe("入力経路。receipt=レシート写真、manual=手入力、voice=音声。省略すると manual"),
    allow_duplicate: z
      .boolean()
      .default(false)
      .describe("true で重複(同日・同額・同じ店)でも強制登録する。同日に同額の別の買い物が実際にあった場合だけ使う"),
  })
  .superRefine((t, ctx) => {
    const mismatch = itemsTotalMismatch(t.amount, t.items ?? []);
    if (mismatch) ctx.addIssue({ code: "custom", path: ["items"], message: mismatch });
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
  category: z
    .string()
    .min(1)
    .optional()
    .describe("カテゴリ名で絞り込む。明細のある取引は、行の実効カテゴリ(行のカテゴリ、無ければ取引のカテゴリ)のどれかが当てはまれば含める"),
  tax_flag: z
    .enum(TAX_FLAG_FILTERS, { error: `tax_flag は ${TAX_FLAG_FILTERS.join(" / ")} のいずれかで指定してください` })
    .optional()
    .describe(`${TAX_FLAG_FILTER_DESCRIPTION}。明細のある取引は、行の実効フラグ(行のフラグ、無ければ取引のフラグ)のどれかが当てはまれば含める`),
  keyword: z
    .string()
    .trim()
    .min(1, "keyword は1文字以上で指定してください")
    .max(100, "keyword は100文字以内にしてください")
    .optional()
    .describe(
      "キーワードで絞り込む。店名・電話番号・住所・担当者名(clerk_name)・メモ・レシート番号・登録番号のどれかに部分一致(英字の大文字小文字は区別しない)。電話番号は、ハイフンや括弧の有無にかかわらず数字だけでも当たる(例: 0300000000)。後から店に問い合わせるときに、電話番号や担当者名から取引を探す用途",
    ),
  limit: z.number().int().min(1).max(500).default(100).describe("最大件数(既定100、最大500)"),
  include_items: z.boolean().default(true).describe("true(既定)で各取引の明細(items)も返す。false で明細を省く(件数の多い一覧を軽くするとき)"),
});

export const COLORS = ["red", "orange", "green", "blue", "purple"] as const;

// 出来事(日付や期間のメモ)。MCPの入力定義には eventFieldsSchema.shape を使い、検証は eventInputSchema で行う
export const eventFieldsSchema = z.strictObject({
  title: z.string().trim().min(1, "title は必須です").max(100).describe("出来事のタイトル(例: 出張、誕生日)"),
  start_date: isoDate.describe("開始日(YYYY-MM-DD)。単日の出来事は、この日だけ"),
  end_date: isoDate.optional().describe("終了日(YYYY-MM-DD)。期間のときだけ。開始日以降"),
  note: z.string().max(1000).optional().describe("メモ(任意)"),
  color: z.enum(COLORS).default("blue").describe("色。red / orange / green / blue / purple のいずれか。省略すると blue"),
});

export const eventInputSchema = eventFieldsSchema.refine((e) => !e.end_date || e.end_date >= e.start_date, {
  message: "end_date は start_date 以降の日付にしてください",
  path: ["end_date"],
});

export type EventInput = z.infer<typeof eventInputSchema>;

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
