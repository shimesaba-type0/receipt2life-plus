import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addTransactionsSchema, listTransactionsSchema } from "../../core/schema";
import { deleteTransactionSchema, updateTransactionFieldsSchema } from "../../core/transaction-edit-schema";
import { addTransactions, deleteTransaction, listTransactions, updateTransaction } from "../../core/transactions";
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
        "category と account は既存の名前から選ぶ。選べる名前は list_categories で取れる(初期値 カテゴリ: 食費、日用品、交通・チャージ、娯楽、その他 / 口座: 現金、カード、Suica)。",
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

  server.registerTool(
    "update_transaction",
    {
      title: "取引を修正する",
      description: [
        "登録済みの取引を修正する。誤って登録した金額・店名・カテゴリなどを直すときに使う。",
        "id は必須。list_transactions で対象の id を確認してから呼ぶ。",
        "直したい項目だけを渡す。渡さなかった項目は変わらない。",
        "項目: date(YYYY-MM-DD・未来日不可)、amount(円・整数、1〜10,000,000)、merchant(店名)、category(カテゴリ名)、account(口座名)、memo、source(receipt / manual / voice)。",
        "merchant / category / account / memo は null を渡すと空にできる。date / amount / source は空にできない。",
        "category と account は既存の名前から選ぶ。未知の名前はエラーになり、選べる値が返る。",
        "修正後、店名とカテゴリが両方あれば status は ok、どちらかが空なら needs_review に自動で変わる。",
        "修正後に、同じ日・金額・店の別の取引があると、更新は行ったうえで warnings に重複の疑いのある取引 id が返る。重複なら、不要な側を delete_transaction で削除する。",
        "存在しない id や不正な値はエラーになり、errors に項目名と理由が返るので、直して再送する。",
      ].join("\n"),
      inputSchema: updateTransactionFieldsSchema.shape,
    },
    async (args) => toResult(await updateTransaction(db, args)),
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "取引を削除する",
      description: [
        "登録済みの取引を1件削除する。重複して登録したものや、誤って登録したものを消すときに使う。",
        "削除は取り消せない。必ず先に list_transactions で id と内容を確認し、消してよい取引だけを指定する。内容の修正だけなら update_transaction を使う。",
        "写真が紐づいている取引は、削除せずエラーにする(Web UIで写真を外してから削除する)。",
        "存在しない id もエラーになる。成功すると、削除した取引の内容を返す。",
      ].join("\n"),
      inputSchema: deleteTransactionSchema.shape,
    },
    async (args) => toResult(await deleteTransaction(db, args)),
  );
}
