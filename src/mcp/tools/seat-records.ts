import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addSeatRecord,
  deleteSeatRecord,
  deleteSeatRecordSchema,
  listSeatRecords,
  listSeatRecordsFieldsSchema,
  newSeatRecordSchema,
  updateSeatRecord,
  updateSeatRecordFieldsSchema,
} from "../../core/seat-records";
import { toResult } from "../result";

// 座席の記録のツール: add_seat_record / list_seat_records / update_seat_record / delete_seat_record
export function registerSeatRecordTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_seat_record",
    {
      title: "座席の記録を登録する",
      description: [
        "映画館のスクリーン・座席など、会場の席の評価を1件、構造化して残す(メモではなく検索できる記録になる)。映画以外(劇場、ライブ会場など)にも使える。作品名・公演名は title に入れる(明細の品名とは別)。",
        "date(YYYY-MM-DD)、venue(会場名)、seat(座席。例: F-5)は必須。title(作品名・公演名)、screen(スクリーン・ホール名)、rating(席の評価。整数1〜5、5が最良)、note(一言。例「前すぎて首が疲れた」)は任意。transaction_id でチケット代などの取引に紐づけられる(任意。存在しない id はエラー)。",
        "title は作品名や公演名(映画のタイトル、ライブ名など)。会場・スクリーン・座席とは別に、そのときの催しの名前を入れる。明細の品名とは別物(明細は取引の品目、title は座席の記録に持つ催しの名前)。ユーザーが作品名・公演名を言ったら title に入れる。言っていなければ省略する(勝手に作らない)。",
        "登録前に、必ず list_seat_records で既存の会場名・スクリーン名を確認して、同じ表記にそろえる(「TOHOシネマズ梅田」と「トーホーシネマズ梅田」のような表記ゆれで、同じ会場の記録が分かれないようにする)。",
        "ユーザーが席の感想を話したら、rating と note に変えて登録する。評価を言っていなければ rating は省略する(勝手に決めない)。",
        "成功すると、登録した記録(id つき)が返る。rating が1〜5の整数でなければエラーになる。",
      ].join("\n"),
      inputSchema: newSeatRecordSchema.shape,
    },
    async (args) => toResult(await addSeatRecord(db, args)),
  );

  server.registerTool(
    "list_seat_records",
    {
      title: "座席の記録を一覧する",
      description: [
        "登録済みの座席の記録を、日付の新しい順に返す。絞り込み(すべて任意・AND): title(作品名・公演名。部分一致。映画のタイトル、ライブ名など。会場・スクリーン・座席とは別に催しの名前で探せる)、venue、screen、seat(いずれも完全一致)、min_rating / max_rating、from / to(日付)、transaction_id。limit は records の最大件数(既定100、最大500)。",
        "返り値: count(絞り込みに合う全件の数)、records(各要素は id、date、title(作品名・公演名。なければ null)、venue、screen、seat、rating、note、transaction_id、created_at)、summary(venue・screen・seat ごとの件数 count、評価のある件数 rated_count、平均評価 avg_rating。評価がなければ null)。count と summary は limit に関わらず絞り込みに合う全件で数える。",
        "使いどころ1: 登録前に、引数なし(または venue だけ)で呼んで、既存の会場名・スクリーン名を確認し、同じ表記にそろえる。",
        "使いどころ2: 次の席選びの参考にする。ユーザーが席(例: F-5)や会場・スクリーンを挙げたら、その venue / screen / seat で絞って呼び、その席が過去に評価されていたか(rating・note)を、平均評価と一言を添えて要約して伝える。評価の高い席を探すなら min_rating: 4 などで絞る。記録がなければ「記録はない」と伝える。",
        "update_seat_record / delete_seat_record に渡す id を調べるときにも使う。",
      ].join("\n"),
      inputSchema: listSeatRecordsFieldsSchema.shape,
    },
    async (args) => toResult(await listSeatRecords(db, args)),
  );

  server.registerTool(
    "update_seat_record",
    {
      title: "座席の記録を直す",
      description: [
        "登録済みの座席の記録を直す。id は必須(list_seat_records で分かる)。変えたい項目だけ指定する(省略した項目は変わらない)。1つ以上の指定が必要。",
        "title(作品名・公演名。映画のタイトル、ライブ名など。会場・スクリーン・座席とは別の催しの名前で、明細の品名とは別物) / screen / rating / note / transaction_id は null で消去(取引の紐づけは外す)。date / venue / seat は消せない(変更のみ)。会場名・スクリーン名を直すときも、表記は既存の記録にそろえる。",
        "存在しない id、範囲外の rating、存在しない transaction_id はエラーになる。",
      ].join("\n"),
      inputSchema: updateSeatRecordFieldsSchema.shape,
    },
    async (args) => toResult(await updateSeatRecord(db, args)),
  );

  server.registerTool(
    "delete_seat_record",
    {
      title: "座席の記録を削除する",
      description: [
        "座席の記録を1件削除する。id は必須(list_seat_records で分かる)。登録しまちがえた記録を消すときに使う。紐づけていた取引は消えない。",
        "存在しない id はエラーになる。逆に、取引を削除しても座席の記録は消えない(紐づけだけが外れる)。",
      ].join("\n"),
      inputSchema: deleteSeatRecordSchema.shape,
    },
    async (args) => toResult(await deleteSeatRecord(db, args)),
  );
}
