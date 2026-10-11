import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addTransactionsSchema, listTransactionsSchema } from "../../core/schema";
import { addTransactions, listTransactions } from "../../core/transactions";
import { toResult } from "../result";

// 取引のツール。update_transaction / delete_transaction もここに足す
export function registerTransactionTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_transactions",
    {
      title: "取引を登録する",
      description: [
        "支出(取引)を登録する。transactions は配列で、1枚のレシートにつき1件。",
        "1枚の写真に複数のレシートが写っていたら、別々の取引にして1回の呼び出しでまとめて送る。",
        "必須は amount(円・整数)だけ。読み取れなかった項目は省略してよい(店名かカテゴリが空だと needs_review になり、後で見直せる)。",
        "category と account は既存の名前から選ぶ(カテゴリは list_categories 相当の値: 食費、日用品、交通・チャージ、娯楽、その他。口座: 現金、カード、Suica)。",
        "よく使う型の目安: 駐車場→交通・チャージ/現金、Suicaチャージ→交通・チャージ/Suica、自販機→食費/現金。",
        "同日・同額・同じ店の取引は重複として登録せず、既存IDを返す。実際に別の買い物なら allow_duplicate:true を付けて再送する。",
        "全件成功か全件失敗。エラーなら errors に index と項目名と理由が返るので、直して再送する。",
        "写真の添付は、このツールではできない(Web UIから行う)。",
      ].join("\n"),
      inputSchema: addTransactionsSchema.shape,
    },
    async (args) => toResult(await addTransactions(db, args)),
  );

  server.registerTool(
    "list_transactions",
    {
      title: "取引を一覧する",
      description: [
        "登録済みの取引を、日付の新しい順で返す。",
        "from / to(YYYY-MM-DD、両端を含む)と category(カテゴリ名)で絞り込める。limit は既定100、最大500。",
        "登録前に重複を確かめたいときや、直近の記録を見返したいときに使う。",
      ].join("\n"),
      inputSchema: listTransactionsSchema.shape,
    },
    async (args) => toResult(await listTransactions(db, args)),
  );
}
