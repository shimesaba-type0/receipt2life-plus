import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compareMonths, compareSchema } from "../../core/compare";
import { toResult } from "../result";

// 月の比較のツール: compare_months
export function registerCompareTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "compare_months",
    {
      title: "月どうしの支出を比べる",
      description: [
        "ある月の支出を、先月・前年の同じ月・好きな月と、大分類(またはカテゴリ)ごとに比べる。読み取り専用。",
        "使いどころ: 「先月と比べて使いすぎ?」「去年の10月と比べてどう?」「9月と10月で何が増えた?」のような質問。",
        "month は比べる月(YYYY-MM、省略すると今月)。base は比べる相手で、previous=先月(既定)、year_ago=前年の同じ月、または YYYY-MM(好きな月)。同じ月どうしはエラー。group_by は group=大分類(既定)かcategory=カテゴリ。",
        "今月がまだ途中のときは、until_day に今日の日(1〜31)を渡すと、どちらの月も「その日まで」にそろえて比べる(月末までの先月と比べると、必ず減って見えるため)。伝えるときは、そろえた日を添える。",
        "戻りは total / base_total(それぞれの月の支出の合計)、diff(増えたら正)、diff_percent(増減の%。比べる側が0円以下なら null)、rows(大分類ごとの total / base_total / diff / diff_percent。今月の金額の大きい順。片方の月にしかない項目も入る)、count / base_count(レシートの数)、message(要約)。",
        "これは「記録した範囲の比較」で、記録のない支出は含まれない。記録漏れがありうるので、断定せず傾向として伝える。",
      ].join("\n"),
      inputSchema: compareSchema.shape,
    },
    async (args) => toResult(await compareMonths(db, args)),
  );
}
