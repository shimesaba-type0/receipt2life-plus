import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addAccount, addAccountSchema, deleteAccount, deleteAccountFieldsSchema, updateAccount, updateAccountFieldsSchema } from "../../core/accounts";
import { toResult } from "../result";

// 口座(支払方法)の管理ツール: add_account / update_account / delete_account(一覧は list_categories の accounts)
export function registerAccountTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_account",
    {
      title: "口座(支払方法)を追加する",
      description: [
        "口座(支払方法。現金・カード・Suica など)を1つ追加する。追加したあとは、add_transactions の account にその名前を使える。",
        "使いどころ: 登録したい支出の支払方法が、既存の口座に無いとき(メモに書いて済ませず、ここで口座にする)。add_transactions は未知の口座名をエラーにする(自動では増えない)ので、先にこのツールで作る。",
        "必ず利用者に確認してから追加する。まず list_categories で既存の口座(accounts)を確かめ、表記ゆれ(「現金」と「げんきん」、「カード」と「クレジットカード」など)で似た口座を増やさない。既存のもので足りるなら新しく作らない。",
        "name は口座の名前(30文字まで)で、全体で一意。同じ名前が既にあるとエラー。前後の空白は取り除く。",
      ].join("\n"),
      inputSchema: addAccountSchema.shape,
    },
    async (args) => toResult(await addAccount(db, args)),
  );

  server.registerTool(
    "update_account",
    {
      title: "口座(支払方法)の名前を変える",
      description: [
        "既存の口座の名前を変える。誤字の修正や、表記の統一に使う。",
        "name は今の名前(list_categories の accounts で確かめる)、new_name は新しい名前(30文字まで、他の口座と重複不可)。今と同じ名前、存在しない name はエラー。変更する前に、利用者に確認する。",
        "その口座を使っている支出は、そのまま新しい名前で表示される(支出の付け替えは不要)。",
        "支出を別の口座へ移したいときは update_transaction の account を使うか、delete_account の move_to を使う。",
      ].join("\n"),
      inputSchema: updateAccountFieldsSchema.shape,
    },
    async (args) => toResult(await updateAccount(db, args)),
  );

  server.registerTool(
    "delete_account",
    {
      title: "口座(支払方法)を削除する",
      description: [
        "口座を1つ削除する。削除は取り消せない。必ず利用者に確認してから使う。先に list_transactions などで、その口座を使っている支出があるか確かめる。",
        "使っている支出がなければ、name だけで削除できる。",
        "使っている支出があるときは、move_to に移し先の口座名を指定する必要がある(指定しないとエラーになり、件数が返る)。move_to を付けると、支出の口座を移し先に付け替えてから削除する。支出そのものは消えない。",
        "存在しない name や move_to はエラー。似た口座を統合したいときは、統合先を move_to にして、いらない方を削除する。",
      ].join("\n"),
      inputSchema: deleteAccountFieldsSchema.shape,
    },
    async (args) => toResult(await deleteAccount(db, args)),
  );
}
