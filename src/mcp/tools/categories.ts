import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addCategory, addCategorySchema, deleteCategory, deleteCategoryFieldsSchema, renameGroup, renameGroupSchema, updateCategory, updateCategoryFieldsSchema } from "../../core/categories";
import { CATEGORY_ICON_CHOICES } from "../../core/category-icons";
import { toResult } from "../result";

// カテゴリの管理ツール: add_category / update_category / delete_category / rename_group(一覧は list_categories)
export function registerCategoryTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_category",
    {
      title: "カテゴリを追加する",
      description: [
        "カテゴリ(サブカテゴリ)を1つ追加する。Zaimのように、大きく分けた「大分類」(group_name)の下にサブカテゴリ(name)を作る。",
        "使いどころ: 登録したい支出が既存のカテゴリに合わないとき。先にこのツールで新しいカテゴリを作ってから、add_transactions の category にその名前を使う。例: 大分類「住まい」の下に「光熱費」を作る。",
        "name はカテゴリの名前(30文字まで)で、全体で一意。同じ名前が既にあるとエラー(別の大分類にあっても)。前後の空白は取り除く。",
        "group_name は所属させる大分類(20文字まで)。既存の大分類でも、新しい名前でもよい(新しければ大分類が増える)。先に list_categories で既存の大分類を確かめ、近いものがあればそれに揃える。",
        `icon はアイコンのキー。新しいカテゴリを作るときは、名前に合うアイコンを付ける(画面で一覧の見分けがつく)。選べるキー: ${CATEGORY_ICON_CHOICES}。例: 「タクシー」→ taxi、「映画」→ movie。合うものがなければ other。一覧にない値はエラー。`,
        "既存のカテゴリで足りるなら、新しく作らない(似た名前を増やさない)。成功すると、追加したカテゴリと新しい大分類かどうかを返す。",
      ].join("\n"),
      inputSchema: addCategorySchema.shape,
    },
    async (args) => toResult(await addCategory(db, args)),
  );

  server.registerTool(
    "update_category",
    {
      title: "カテゴリを変更する",
      description: [
        "既存のカテゴリの名前を変える、別の大分類へ移す、またはアイコンを変える。誤字の修正や、大分類の整理に使う。",
        `name は今の名前(list_categories で確かめる)。変えたい項目だけ渡す: new_name=新しい名前(30文字まで、他と重複不可)、group_name=移す先の大分類(20文字まで。新しい名前なら大分類が増える)、icon=アイコンのキー(null で外す。選べるキー: ${CATEGORY_ICON_CHOICES})。1つも渡さない、または今と同じ値だとエラー。`,
        "そのカテゴリを使っている支出は、そのまま新しい名前・大分類に付いてくる(支出の付け替えは不要)。支出を別のカテゴリへ移したいときは update_transaction を使うか、delete_category の move_to を使う。",
        "大分類の名前をまとめて変えたいときは rename_group を使う。",
      ].join("\n"),
      inputSchema: updateCategoryFieldsSchema.shape,
    },
    async (args) => toResult(await updateCategory(db, args)),
  );

  server.registerTool(
    "delete_category",
    {
      title: "カテゴリを削除する",
      description: [
        "カテゴリを1つ削除する。削除は取り消せない。先に list_categories で usage(そのカテゴリを使っている支出の件数)を確かめ、利用者の意図を確認してから使う。",
        "usage が 0 なら、name だけで削除できる。",
        "使っている支出があるときは、move_to に移し先のカテゴリ名を指定する必要がある(指定しないとエラーになり、件数が返る)。move_to を付けると、支出のカテゴリを移し先に付け替えてから削除する。支出そのものは消えない。",
        "最後の1つのカテゴリは削除できない。存在しない name や move_to はエラー。",
        "似たカテゴリを統合したいときの使い方: 統合先を move_to にして、いらない方を削除する。",
      ].join("\n"),
      inputSchema: deleteCategoryFieldsSchema.shape,
    },
    async (args) => toResult(await deleteCategory(db, args)),
  );

  server.registerTool(
    "rename_group",
    {
      title: "大分類の名前を変える",
      description: [
        "大分類(カテゴリをまとめる見出し。summarize の group_by:\"group\" の単位)の名前を変える。その大分類にあるすべてのカテゴリの大分類名が変わる。",
        "group は今の大分類名、new_name は新しい名前(20文字まで)。既にある別の大分類と同じ名前にすると、その大分類に統合される(確認なしで実行され、結果に件数と統合したかが返る)。",
        "1つのカテゴリだけを別の大分類へ移したいときは update_category の group_name を使う。存在しない大分類名や、今と同じ名前はエラー。",
      ].join("\n"),
      inputSchema: renameGroupSchema.shape,
    },
    async (args) => toResult(await renameGroup(db, args)),
  );
}
