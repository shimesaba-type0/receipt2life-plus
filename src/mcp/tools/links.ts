import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TitleFetcher } from "../../core/link-titles";
import { addLink, deleteLink, deleteLinkSchema, linkFieldsSchema, listLinks, listLinksFieldsSchema, updateLink, updateLinkSchema } from "../../core/links";
import { toResult } from "../result";

// 外部リンクのツール: add_link / list_links / update_link / delete_link
export function registerLinkTools(server: McpServer, db: D1Database, fetchTitle?: TitleFetcher): void {
  server.registerTool(
    "add_link",
    {
      title: "リンクを登録する",
      description: [
        "Xの投稿・YouTubeの動画・Instagramの投稿のリンクを、その日の記録・取引・出来事に付けて残す。例: 旅行の出来事に動画のリンクを付ける、ライブの日に感想の投稿を残す、買い物の取引に紹介動画を付ける。",
        "url は必須。対応しているのは https のURLだけで、Xの投稿(x.com / twitter.com の /<ユーザー名>/status/<数字>。ユーザーのプロフィールも可)と、Instagramの投稿・リール(instagram.com の /p/<コード>/、/reel/<コード>/。プロフィール /<ユーザー名>/ も可。タイトルは自動では取得できないので、必要なら title に入れる)と、YouTubeの動画(youtube.com の watch?v=<動画ID>、/shorts/<動画ID>、/live/<動画ID>、/playlist?list=<ID>、youtu.be/<動画ID>)。",
        "許可リスト以外のサイト、http、ポート番号、user:pass@ の付いたURLはエラーになる(errors に対応サイトと直し方が返る)。URLは正規化して保存する(#以降と、utm_* などの追跡用の項目は消える。YouTubeの t=開始秒 は残る)。",
        "date(YYYY-MM-DD)、transaction_id(取引のid)、event_id(出来事のid)のうち1つ以上が必須。存在しない id はエラーになる。title は任意の表題(200文字まで)。省略すると、YouTube の動画のタイトルや、Xの投稿の投稿者名と本文の先頭を、公式の oEmbed から自動で取得して付ける(取得できなければ表題なしで登録される。動画や投稿が非公開・削除されているときなど)。Instagram や、表題が付かなかったときは、AI が自分でページを見て表題を調べ、title に入れて登録するか、あとで update_link で付ける。作品名などを表題にしたいときは、title に入れる。",
        "同じ紐づけ先に同じURLが既にあれば、登録せずに既存のリンクを返す(duplicate: true)。",
        "成功すると、登録したリンク(id つき)が返る。",
      ].join("\n"),
      inputSchema: linkFieldsSchema.shape,
    },
    async (args) => toResult(await addLink(db, args, { fetchTitle })),
  );

  server.registerTool(
    "list_links",
    {
      title: "リンクを一覧する",
      description: [
        "登録済みのリンク(Xの投稿・YouTubeの動画・Instagramの投稿)を返す。各要素は id、url、kind(x / youtube / instagram)、title、date、transaction_id、event_id、created_at。",
        "date、transaction_id、event_id のうち1つ以上が必須。複数を指定したら、どれかに当てはまるリンクをまとめて返す(重複なし)。",
        "date を指定すると、その日の詳細画面と同じ範囲になる。その日の日付に付いたリンクに加えて、その日の取引に付いたリンクと、その日を含む期間の出来事に付いたリンクも含まれる。",
        "使いどころ: 「この日に残したリンクを見せて」と頼まれたとき、または delete_link に渡す id を調べるとき。存在しない id はエラーになる。",
      ].join("\n"),
      inputSchema: listLinksFieldsSchema.shape,
    },
    async (args) => toResult(await listLinks(db, args)),
  );

  server.registerTool(
    "update_link",
    {
      title: "リンクの表題を更新する",
      description: [
        "登録済みのリンクの表題(title)を変える。id は必須(list_links で分かる)。title に新しい表題、null で消去。",
        "使いどころ: 表題が付かなかったリンク(list_links で title が null のもの。Instagram や、自動取得に失敗したもの)に、AI がページを見て分かったタイトル・作品名などを付けるとき。",
        "表題は200文字まで。URL や紐づけ先は変えられない(変えるなら、delete_link で消して add_link で登録し直す)。存在しない id はエラーになる。",
      ].join("\n"),
      inputSchema: updateLinkSchema.shape,
    },
    async (args) => toResult(await updateLink(db, args)),
  );

  server.registerTool(
    "delete_link",
    {
      title: "リンクを削除する",
      description: [
        "リンクを1件削除する。id は必須(list_links で分かる)。登録しまちがえたURLや、いらなくなったリンクを消すときに使う。取引や出来事そのものは消えない。",
        "存在しない id はエラーになる。取引や出来事を削除すると、それに付いたリンクもいっしょに消える。",
      ].join("\n"),
      inputSchema: deleteLinkSchema.shape,
    },
    async (args) => toResult(await deleteLink(db, args)),
  );
}
