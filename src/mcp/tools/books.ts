import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addBook, deleteBook, deleteBookSchema, listBooks, listBooksFieldsSchema, newBookSchema, updateBook, updateBookFieldsSchema } from "../../core/books";
import { toResult } from "../result";

// 買った本のツール: add_book / list_books / update_book / delete_book
export function registerBookTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_book",
    {
      title: "買った本を記録する",
      description: [
        "買った本を1冊、構造化して残す(買った本を忘れて、同じ本を買い直さないため)。isbn か title のどちらかは必須。isbn(10桁か13桁。ハイフンは付けてもよい)は、チェックディジットを確かめて13桁にそろえて保存する。",
        "このアプリは外のサービスに接続しない。ユーザーが ISBN だけを言ったときは、あなた(AI)がネットで ISBN を調べ、title(タイトル)・author(著者)・series(シリーズ名)を入れて登録する。調べても分からなかった項目は、勝手に作らず省略する。",
        "buyer は購入者(買った人)、note はメモ、purchased_on は買った日(YYYY-MM-DD)。いずれも任意で、ユーザーが言っていなければ省略する。transaction_id でレシートの取引に紐づけられる(任意。存在しない id はエラー)。purchased_on を省略して transaction_id を付けると、その取引の日付が買った日になる。",
        "登録前に list_books(isbn で絞る)で、同じ本がすでにないか確かめる。シリーズ名・著者名・購入者は、list_books の facets にある既存の表記に合わせる(表記ゆれで、同じシリーズが分かれないように)。",
        "成功すると、登録した記録(id つき)が返る。同じ ISBN の本がすでにあるときは、応答のメッセージで知らせる(登録は止めない)。",
      ].join("\n"),
      inputSchema: newBookSchema.shape,
    },
    async (args) => toResult(await addBook(db, args)),
  );

  server.registerTool(
    "list_books",
    {
      title: "買った本を一覧する",
      description: [
        "登録済みの本の記録を、買った日の新しい順に返す(日がない本は最後)。絞り込み(すべて任意・AND): q(タイトル・著者・シリーズ・購入者・メモ・ISBN に部分一致。空白で区切るとすべてを含むものに絞る)、series / author / buyer(完全一致)、isbn(10桁でも13桁でも)、from / to(買った日)、transaction_id、unlinked(true でレシートに紐づいていない本だけ)、limit(既定100、最大500)。",
        "返り値: count(絞り込みに合う全件の数)、records(各要素は id、isbn、title、author、series、buyer、note、purchased_on(買った日。紐づけた取引の日付を借りることがある)、transaction_id、created_at)、facets(series / authors / buyers の既存の表記の一覧)。",
        "使いどころ1: 「この本は買ったっけ?」と聞かれたら、isbn か q で探して答える。使いどころ2: 登録の前に、同じ本がないか・表記をそろえる名前があるかを確かめる。update_book / delete_book に渡す id を調べるときにも使う。",
      ].join("\n"),
      inputSchema: listBooksFieldsSchema.shape,
    },
    async (args) => toResult(await listBooks(db, args)),
  );

  server.registerTool(
    "update_book",
    {
      title: "本の記録を直す",
      description: [
        "登録済みの本の記録を直す。id は必須(list_books で分かる)。変えたい項目だけ指定する(省略した項目は変わらない)。1つ以上の指定が必要。",
        "isbn / title / author / series / buyer / note / purchased_on / transaction_id は null で消去できる(transaction_id は紐づけを外す。purchased_on を消すと、紐づけた取引の日付になる)。ただし isbn と title の両方は消せない。ISBN は13桁にそろえて保存する。",
      ].join("\n"),
      inputSchema: updateBookFieldsSchema.shape,
    },
    async (args) => toResult(await updateBook(db, args)),
  );

  server.registerTool(
    "delete_book",
    {
      title: "本の記録を削除する",
      description: "本の記録を1件削除する。id は必須(list_books で分かる)。削除したら元に戻せないので、ユーザーに確かめてから呼ぶ。紐づけたレシートの取引は消えない。",
      inputSchema: deleteBookSchema.shape,
    },
    async (args) => toResult(await deleteBook(db, args)),
  );
}
