import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listCategories } from "../../core/categories";
import { summarizeSchema } from "../../core/report-schema";
import { summarize } from "../../core/summarize";
import { toResult } from "../result";

// 集計・参照系のツール: summarize / list_categories
export function registerReportTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "summarize",
    {
      title: "支出を集計する",
      description: [
        "登録済みの取引を期間と軸で集計し、件数・合計金額・全体に対する割合(%)を返す。",
        "group_by は必須で、次のいずれか。category=カテゴリ別(カテゴリなしは「(未分類)」)、group=カテゴリの大分類別(食費・生活・交通・娯楽・その他など。なしは「(未分類)」)、month=月別(キーは YYYY-MM、古い順)、merchant=店名別(店名なしは「(店名なし)」。表記ゆれの正規化はしない)、event_id=出来事別。",
        "category・group・merchant・event_id は合計金額の大きい順、month は古い順で返る。",
        "期間は from / to(YYYY-MM-DD、両端を含む)。どちらも省略すると全期間。from が to より後だとエラー。",
        "event_id は、取引の日付が出来事の期間(start_date〜end_date。単日なら当日)に入っているものをその出来事に数える。1つの取引が複数の出来事に入るときは、それぞれに数えるため、行の合計や割合の和が全体(total)を超えることがある(二重計上)。どの出来事にも入らない取引は「(出来事なし)」にまとまる。",
        "戻りの total と count は、期間内の全取引の合計と件数。percent は行の合計 ÷ total × 100(小数第1位)。message に上位数件の要約が入る。",
        "この集計は「記録した範囲の傾向」であり、記録のない支出は含まれない。記録漏れがありうるので、断定せず傾向として伝える。",
      ].join("\n"),
      inputSchema: summarizeSchema.shape,
    },
    async (args) => toResult(await summarize(db, args)),
  );

  server.registerTool(
    "list_categories",
    {
      title: "カテゴリと口座を一覧する",
      description: [
        "登録できるカテゴリ(name と大分類 group_name)と口座の名前を返す。引数はなし。",
        "add_transactions で取引を登録する前に、決められた名前から category と account を選ぶために呼ぶ。",
        "一覧にない名前は登録できないので、近いものに寄せる。決められなければ category は省略する(needs_review になる)。",
      ].join("\n"),
      inputSchema: {},
    },
    async () => toResult(await listCategories(db)),
  );
}
