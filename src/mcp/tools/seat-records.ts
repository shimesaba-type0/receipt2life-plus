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
import { listVenues, updateScreen, updateScreenSchema, updateVenue, updateVenueSchema } from "../../core/venues";
import { toResult } from "../result";

// 座席の記録のツール: add_seat_record / list_seat_records / update_seat_record / delete_seat_record
// と、会場・スクリーンのツール: list_venues / update_venue / update_screen(削除のツールはない)
export function registerSeatRecordTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_seat_record",
    {
      title: "座席の記録を登録する",
      description: [
        "映画館のスクリーン・座席など、会場の席の評価を1件、構造化して残す(メモではなく検索できる記録になる)。映画以外(劇場、ライブ会場など)にも使える。作品名・公演名は title に入れる(明細の品名とは別)。",
        "date(YYYY-MM-DD)、venue(会場名)、seat(座席。例: F-5)は必須。title(作品名・公演名)、screen(スクリーン・ホール名)、rating(席の評価。整数1〜5、5が最良)、note(一言。例「前すぎて首が疲れた」)は任意。transaction_id でチケット代などの取引に紐づけられる(任意。存在しない id はエラー)。",
        "title は作品名や公演名(映画のタイトル、ライブ名など)。会場・スクリーン・座席とは別に、そのときの催しの名前を入れる。明細の品名とは別物(明細は取引の品目、title は座席の記録に持つ催しの名前)。ユーザーが作品名・公演名を言ったら title に入れる。言っていなければ省略する(勝手に作らない)。",
        "会場(venue)とスクリーン(screen)は別のレコードで、ここでは名前で指す。名前が既存と完全一致すればそれを使い、無ければ自動で作る。応答の created_venue / created_screen が true なら新規に作ったので、既存の表記ゆれ(「TOHOシネマズ梅田」と「トーホーシネマズ梅田」など)でないか確かめる。",
        "登録前に、必ず list_venues で既存の会場・スクリーンを確認して、同じ名前を使う。新しい名前を作る前に、ユーザーに確認する(表記ゆれで、同じ会場の記録が分かれないようにする)。",
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
        "返り値: count(絞り込みに合う全件の数)、records(各要素は id、date、title(作品名・公演名。なければ null)、venue(会場名)、venue_id、screen(スクリーン名。なければ null)、screen_id、screen_note(そのスクリーンの特徴)、seat、rating、note、transaction_id、created_at)、summary(venue・screen・seat ごとの件数 count、評価のある件数 rated_count、平均評価 avg_rating。評価がなければ null)。count と summary は limit に関わらず絞り込みに合う全件で数える。",
        "使いどころ1: 会場・スクリーンの名前の確認は list_venues を使う(会場ごとのスクリーン、記録件数、平均評価、スクリーンの特徴 note が分かる)。",
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
        "title(作品名・公演名。映画のタイトル、ライブ名など。会場・スクリーン・座席とは別の催しの名前で、明細の品名とは別物) / screen / rating / note / transaction_id は null で消去(取引の紐づけは外す)。date / venue / seat は消せない(変更のみ)。venue / screen は名前で指定し、無ければ自動で作る(応答の created_venue / created_screen で分かる)。venue だけ変えて screen を省略すると、同じスクリーン名を新しい会場の下で探す(無ければ作る)。表記は list_venues で確かめた既存の名前にそろえる。移して空になった会場・スクリーン(note もないもの)は自動で片づく。会場名・スクリーン名そのものを直すだけなら update_venue / update_screen を使う。",
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

  server.registerTool(
    "list_venues",
    {
      title: "会場・スクリーンの一覧",
      description: [
        "登録済みの会場と、その下のスクリーンを返す(引数なし)。席選びの参考と、表記ゆれの防止に使う。",
        "返り値: venues(各要素は id、name、record_count(その会場の記録の件数)、rated_count、avg_rating(平均評価。評価がなければ null)、screens)。screens の各要素は id、name、note(そのスクリーンの特徴。例「前方は首が疲れる」。なければ null)、record_count、rated_count、avg_rating。",
        "使いどころ1: add_seat_record / update_seat_record の前に呼んで、既存の会場・スクリーンの名前を確認し、同じ名前を使う。新しい名前を作る前に、ユーザーに確認する。",
        "使いどころ2: ユーザーが次の席選びを相談したら、会場のスクリーンごとの平均評価と note を要約して伝える。席ごとの評価は list_seat_records(venue・screen で絞る)で分かる。",
      ].join("\n"),
      inputSchema: {},
    },
    async () => toResult(await listVenues(db)),
  );

  server.registerTool(
    "update_venue",
    {
      title: "会場名を直す",
      description: [
        "会場の名前を変える。id と name は必須(id は list_venues で分かる)。その会場の記録は、そのまま新しい名前になる。",
        "同じ名前の会場が既にあるとエラー(会場の統合はできない)。表記ゆれで会場が分かれてしまったときは、記録ごとに update_seat_record の venue を既存の名前に直す。削除のツールはない。",
      ].join("\n"),
      inputSchema: updateVenueSchema.shape,
    },
    async (args) => toResult(await updateVenue(db, args)),
  );

  server.registerTool(
    "update_screen",
    {
      title: "スクリーン名・特徴を直す",
      description: [
        "スクリーンの名前を変える、またはそのスクリーンの特徴(note)を設定・消去する。id は必須(list_venues で分かる)。変えたい項目(name / note)だけ指定する。1つ以上の指定が必要。",
        "note はそのスクリーンの特徴(例「前方は首が疲れる」「段差が大きく後方でも見やすい」)。null か空文字で消去。席選びの参考として、list_venues で見える。ユーザーが言った特徴だけを書き、推測で書かない。",
        "同じ会場に同じ名前のスクリーンが既にあるとエラー(統合はできない)。削除のツールはない。",
      ].join("\n"),
      inputSchema: updateScreenSchema.shape,
    },
    async (args) => toResult(await updateScreen(db, args)),
  );
}
