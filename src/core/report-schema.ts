import { z } from "zod";
import { isoDate } from "./schema";

export const GROUP_BYS = ["category", "group", "month", "merchant", "event_id"] as const;

// MCPの入力定義には summarizeSchema.shape を使う
export const summarizeSchema = z.strictObject({
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)。省略すると記録の最初から"),
  to: isoDate.optional().describe("この日以前(YYYY-MM-DD)。省略すると記録の最後まで"),
  group_by: z
    .enum(GROUP_BYS, {
      error: `group_by は ${GROUP_BYS.join(" / ")} のいずれかで指定してください(必須)`,
    })
    .describe("集計の軸。category=カテゴリ別、group=カテゴリの大分類別、month=月別、merchant=店名別、event_id=出来事別。必須"),
});

export type SummarizeInput = z.infer<typeof summarizeSchema>;
export type GroupBy = (typeof GROUP_BYS)[number];
