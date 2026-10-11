import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addEvent, listEvents, listEventsSchema, updateEvent, updateEventFieldsSchema } from "../../core/events";
import { eventFieldsSchema } from "../../core/schema";
import { toResult } from "../result";

// 出来事(期間メモ)のツール: add_event / update_event / list_events
export function registerEventTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_event",
    {
      title: "出来事を登録する",
      description: [
        "出来事(日付や期間のメモ)を1件登録する。出張、旅行、誕生日、引っ越しなど、支出の背景になる予定や出来事を残すために使う。配列ではなく1件ずつ呼ぶ。",
        "必須は title(タイトル、100文字まで)と start_date(開始日、YYYY-MM-DD)。",
        "単日の出来事は start_date だけを指定する(end_date は省略)。複数日にわたる出来事(期間)は end_date(終了日、YYYY-MM-DD、start_date 以降)も指定する。",
        "note はメモ(任意、1000文字まで)。",
        "color は red / orange / green / blue / purple の5色から選ぶ。省略すると blue。",
        "成功すると、登録した出来事(id つき)と確認の文章が返る。エラーなら errors に項目名と理由が返るので、直して再送する。",
      ].join("\n"),
      inputSchema: eventFieldsSchema.shape,
    },
    async (args) => toResult(await addEvent(db, args)),
  );

  server.registerTool(
    "update_event",
    {
      title: "出来事を更新する",
      description: [
        "登録済みの出来事を更新する。id は必須(list_events で取れる)。変えたい項目だけを指定し、省略した項目は今の値のまま残る(color を省略しても青に戻らない)。",
        "title: 新しいタイトル。start_date: 新しい開始日(YYYY-MM-DD)。color: red / orange / green / blue / purple のいずれか。",
        "end_date: 新しい終了日(YYYY-MM-DD)。null を指定すると期間を解除して単日の出来事に戻る。",
        "note: 新しいメモ。null を指定すると消去する。",
        "更新後の開始日と終了日は、既存の値と合わせて検証する(終了日は開始日以降)。",
        "存在しない id はエラーになる。更新する項目が1つもない呼び出しもエラーになる。",
      ].join("\n"),
      inputSchema: updateEventFieldsSchema.shape,
    },
    async (args) => toResult(await updateEvent(db, args)),
  );

  server.registerTool(
    "list_events",
    {
      title: "出来事を一覧する",
      description: [
        "登録済みの出来事を、開始日の古い順で返す。各要素は id、start_date、end_date(単日は null)、title、note、color。",
        "from / to(YYYY-MM-DD、両端を含む)を指定すると、その期間と重なる出来事だけを返す。出来事の範囲は start_date から(end_date があればそれ、なければ start_date)まで。期間の途中から始まる・途中で終わる出来事も含まれる。",
        "limit は既定100、最大500。update_event に渡す id を調べるときや、支出の背景(出張中かどうかなど)を確かめるときに使う。",
      ].join("\n"),
      inputSchema: listEventsSchema.shape,
    },
    async (args) => toResult(await listEvents(db, args)),
  );
}
