import { z } from "zod";
import { isoDate } from "./schema";

export const GROUP_BYS = ["category", "group", "month", "merchant", "event_id", "tax_flag"] as const;

// MCPの入力定義には summarizeSchema.shape を使う
export const summarizeSchema = z.strictObject({
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)。省略すると記録の最初から"),
  to: isoDate.optional().describe("この日以前(YYYY-MM-DD)。省略すると記録の最後まで"),
  group_by: z
    .enum(GROUP_BYS, {
      error: `group_by は ${GROUP_BYS.join(" / ")} のいずれかで指定してください(必須)`,
    })
    .describe("集計の軸。category=カテゴリ別、group=カテゴリの大分類別、month=月別、merchant=店名別、event_id=出来事別、tax_flag=税金の控除用フラグ別(確定申告用。期間を from / to で年に絞る)。必須"),
});

export type SummarizeInput = z.infer<typeof summarizeSchema>;
export type GroupBy = (typeof GROUP_BYS)[number];

export const TAX_GROUP_BYS = ["rate", "month"] as const;
export type TaxGroupBy = (typeof TAX_GROUP_BYS)[number];

// 税率別の税額の集計(summarize_tax)。MCPの入力定義には summarizeTaxSchema.shape を使う
export const summarizeTaxSchema = z.strictObject({
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)。省略すると記録の最初から"),
  to: isoDate.optional().describe("この日以前(YYYY-MM-DD)。省略すると記録の最後まで"),
  group_by: z
    .enum(TAX_GROUP_BYS, { error: `group_by は ${TAX_GROUP_BYS.join(" / ")} のいずれかで指定してください` })
    .default("rate")
    .describe("集計の軸。rate=税率別(既定)、month=月別×税率別"),
});

export type SummarizeTaxInput = z.infer<typeof summarizeTaxSchema>;

export const DISCOUNT_GROUP_BYS = ["none", "merchant", "category", "month"] as const;
export type DiscountGroupBy = (typeof DISCOUNT_GROUP_BYS)[number];

// 割引の集計(summarize の discounts_only: true)。レシートに印字された割引行(amount < 0 の明細)だけが対象
export const summarizeDiscountsSchema = z.strictObject({
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)。省略すると記録の最初から"),
  to: isoDate.optional().describe("この日以前(YYYY-MM-DD)。省略すると記録の最後まで"),
  group_by: z
    .enum(DISCOUNT_GROUP_BYS, { error: `group_by は ${DISCOUNT_GROUP_BYS.join(" / ")} のいずれかで指定してください(割引の集計)` })
    .default("none")
    .describe("割引の集計の軸。none=合計だけ(既定)、merchant=店名別、category=カテゴリ別、month=月別"),
});

export type SummarizeDiscountsInput = z.infer<typeof summarizeDiscountsSchema>;

// MCP の summarize の入力。従来の入力(group_by 必須)に、discounts_only を足した形
// group_by は割引の集計では省略できるので、スキーマ上は任意にし、通常の集計での必須チェックは summarize 側のスキーマが行う
export const summarizeToolSchema = z.strictObject({
  from: summarizeSchema.shape.from,
  to: summarizeSchema.shape.to,
  group_by: z
    .enum([...GROUP_BYS, "none"] as const)
    .optional()
    .describe(
      "集計の軸。通常の集計では必須: category=カテゴリ別、group=カテゴリの大分類別、month=月別、merchant=店名別、event_id=出来事別、tax_flag=税金の控除用フラグ別(確定申告用。期間を from / to で年に絞る)。discounts_only が true のときは none=合計だけ(既定)、merchant、category、month のいずれか",
    ),
  discounts_only: z
    .boolean()
    .optional()
    .describe("true にすると、レシートに印字された割引行(マイナスの明細)だけを集計する(お得金額)。省略または false は従来どおりの支出の集計"),
});

export type SummarizeToolInput = z.infer<typeof summarizeToolSchema>;
