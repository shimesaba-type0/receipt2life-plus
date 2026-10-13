import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchRecords, searchSchema } from "../../core/search";
import { toResult } from "../result";

// 記録の横断検索のツール: search_records
export function registerSearchTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "search_records",
    {
      title: "記録をキーワードで探す",
      description: [
        "取引・出来事・座席の記録・リンク・写真のキャプションを、キーワードでまとめて探し、日付の新しい順に返す。読み取り専用。",
        "使いどころ: 「映画を見たのはいつ?」「皮膚科に最後に行ったのは?」「キャンプに行った日は?」のような、過去の記録を引く質問。latest_date がいちばん新しい日、hits が新しい順の一覧(type、日付、見出し、補足、取引なら金額と id)。",
        "q は必須。空白で区切った語は、すべて含むものに絞る(例: 「映画 TOHO」)。店名、メモ、カテゴリ名、明細の名前、出来事のタイトルとメモ、映画の題名、会場名、リンクのタイトル・説明・URL、写真のキャプションに部分一致する(英字の大文字小文字は区別しない。全角と半角、ひらがなとカタカナは区別するので、見つからなければ別の表記でも試す)。",
        "from / to(YYYY-MM-DD)で期間、types で対象(transaction / event / seat_record / link / photo)を絞れる。limit は既定30、最大100。total は条件に合う全件数。取引だけを金額・カテゴリで絞って集計したいときは list_transactions / summarize を使う。",
      ].join("\n"),
      inputSchema: searchSchema.shape,
    },
    async (args) => toResult(await searchRecords(db, args)),
  );
}
