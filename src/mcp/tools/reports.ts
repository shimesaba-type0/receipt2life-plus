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
        "登録済みの支出を期間と軸で集計し、件数・合計金額・全体に対する割合(%)を返す。",
        "集計の単位は「支出の行」: 明細(items)がある取引は明細の各行(行のカテゴリ・フラグ、無ければ取引のカテゴリ・フラグ)、明細の無い取引は取引そのものを1行として数える。だから1枚のレシートの中の食費と日用品は、それぞれのカテゴリに分かれて入る。rows の count はこの行の数(取引の件数ではない)。行の合計の総和は取引の合計と一致する。",
        "group_by は必須で、次のいずれか。category=カテゴリ別(カテゴリなしは「(未分類)」)、group=カテゴリの大分類別(食費・生活・交通・娯楽・その他など。なしは「(未分類)」)、month=月別(キーは YYYY-MM、古い順)、merchant=店名別(店名なしは「(店名なし)」。表記ゆれの正規化はしない)、event_id=出来事別、tax_flag=税金の控除用フラグ別(行名は医療費控除・セルフメディケーション税制・寄附金控除、フラグなしは「(フラグなし)」)。",
        "category・group・merchant・event_id は合計金額の大きい順、month は古い順で返る。",
        "期間は from / to(YYYY-MM-DD、両端を含む)。どちらも省略すると全期間。from が to より後だとエラー。",
        "event_id は、支出の日付が出来事の期間(start_date〜end_date。単日なら当日)に入っているものをその出来事に数える。1つの取引が複数の出来事に入るときは、それぞれに数えるため、行の合計や割合の和が全体(total)を超えることがある(二重計上)。どの出来事にも入らない取引は「(出来事なし)」にまとまる。",
        "確定申告の準備には、group_by:\"tax_flag\" に年の範囲(例: from 2026-01-01、to 2026-12-31)を付けて、年ごとのフラグ別の合計を出す。出るのは記録した金額の合計だけで、控除の対象になるか・控除額・上限の判定はしない(利用者の責任)。total と割合はフラグなしを含む期間内の全取引が基準。",
        "戻りの total と count は、期間内の全取引の合計と件数(レシートの数)。lines は期間内の支出の行の数。percent は行の合計 ÷ total × 100(小数第1位)。message に上位数件の要約が入る。",
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
        "登録できるカテゴリと口座の名前を返す。引数はなし。",
        "カテゴリは、大分類(group_name)の下にサブカテゴリ(name)が並ぶ構造。groups は大分類ごとのまとまり(各サブカテゴリの usage=そのカテゴリを使っている支出の件数つき)、categories は同じ内容を name / group_name / icon(アイコンのキー。未設定は null) / usage の平らな一覧にしたもの。並びは大分類ごと・追加順で安定している。",
        "add_transactions で取引を登録する前に、決められた名前から category と account を選ぶために呼ぶ。category にはサブカテゴリの名前(name)を使う。",
        "一覧にない名前は登録できないので、近いものに寄せる。合うものが本当に無いときは、add_category で新しいカテゴリを作ってから登録する。決められなければ category は省略する(needs_review になる)。",
        "カテゴリを整理する前(update_category / delete_category / rename_group)に usage を確かめるのにも使う。",
      ].join("\n"),
      inputSchema: {},
    },
    async () => toResult(await listCategories(db)),
  );
}
