import { z } from "zod";
import { checkRefs } from "./photos";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import { escapeLike, type CoreOptions } from "./transactions";
import { parseHttpsUrl } from "./urls";
import {
  findOrCreateScreen,
  findOrCreateVenue,
  MAX_SCREEN_LENGTH,
  MAX_VENUE_LENGTH,
  pruneEmptyVenues,
  screenNameField,
  venueNameField,
} from "./venues";

// 座席の記録(seat_records)。映画館のスクリーン・座席など、会場の席の評価を構造化して残し、次に席を選ぶ参考にする。
// 映画以外(劇場、ライブ会場など)にも使える名前にしてある: venue=会場、screen=スクリーン/ホール、seat=座席。
// seat_class=席種(プレミアムシート、内野指定席、ボックスシート、外野自由席など。任意。座席番号 seat とは別に、その席の種類を持つ。文字列で持ち、会場ごとの席種テーブルは使わない)。
// screen は映画館のスクリーンに限らず、ホール・ブロック・エリアなどの区画にも使う広い意味。
// title=作品名・公演名(映画のタイトル、ライブ名など。任意。明細の品名とは別物)。取引の列は増やさず、取引への紐づけ(transaction_id)は任意。
// 会場(venues)とスクリーン(screens)は別のレコード(migration 0010)。座席の記録は venue_id / screen_id で参照する。
// ただし入出力は従来どおり venue / screen を「名前」で受け渡す(無ければ自動で作る)。結果には venue_id / screen_id も付く。

export { MAX_SCREEN_LENGTH, MAX_VENUE_LENGTH };
export const MAX_TITLE_LENGTH = 100;
export const MAX_SEAT_LENGTH = 50;
export const MAX_SEAT_CLASS_LENGTH = 50;
export const MAX_NOTE_LENGTH = 200;
export const MAX_POSTER_URL_LENGTH = 500;
export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;
// summary(会場・スクリーン・座席ごとの集計)の最大行数
export const MAX_SUMMARY_ROWS = 200;

export interface SeatRecordView {
  id: string;
  date: string;
  // 作品名・公演名(映画のタイトル、ライブ名など)。なければ null
  title: string | null;
  // 会場名・スクリーン名(従来どおり名前)と、その id
  venue: string;
  venue_id: string;
  screen: string | null;
  screen_id: string | null;
  // そのスクリーンの特徴(screens.note)。スクリーンがない・noteがなければ null
  screen_note: string | null;
  seat: string;
  // 席種(プレミアムシート、内野指定席など)。なければ null
  seat_class: string | null;
  // 席の評価(座席の座り心地。作品の感想ではない)
  rating: number | null;
  // 作品の評価(1〜5。席の評価とは別)
  work_rating: number | null;
  note: string | null;
  // ポスター画像のURL(https)。なければ null
  poster_url: string | null;
  transaction_id: string | null;
  created_at: string;
}

// 会場・スクリーン・座席ごとの集計。avg_rating は評価のある記録の平均(小数1桁。評価がなければ null)
export interface SeatSummaryRow {
  venue: string;
  screen: string | null;
  seat: string;
  count: number;
  rated_count: number;
  avg_rating: number | null;
}

// ---- スキーマ(MCP の入力定義・API の検証・型を兼ねる) ----

// ポスター画像のURL。https のみ(ポート・認証情報つきは不可)。500文字まで。空文字は未指定扱い: 追加では NULL、更新では消去
export const posterUrlField = z
  .string({ error: "poster_url は文字列で指定してください" })
  .trim()
  .transform((v, ctx) => {
    if (v === "") return "";
    const u = parseHttpsUrl(v);
    if (u === null || u.length > MAX_POSTER_URL_LENGTH) {
      ctx.addIssue({ code: "custom", message: `poster_url は https のURL(${MAX_POSTER_URL_LENGTH}文字まで)で指定してください` });
      return "";
    }
    return u;
  });
const POSTER_DESCRIPTION = "ポスター画像のURL(https のみ。500文字まで)。任意。画像は保存せず、URLを参照して表示する。ネットで作品を調べたときに分かれば入れる(勝手に作らない)";

const idField = z.string().min(1).max(100);
const venueField = venueNameField;
const screenField = screenNameField;
// 空文字(空白だけを含む)は未指定扱い: 追加では NULL、更新では消去。保存の前に normalizeTitle で整える
const titleField = z.string().trim().max(MAX_TITLE_LENGTH);
const seatField = z.string().trim().min(1).max(MAX_SEAT_LENGTH);
// 席種。空文字(空白だけを含む)は未指定扱い: 追加では NULL、更新では消去
const seatClassField = z.string().trim().max(MAX_SEAT_CLASS_LENGTH);
const noteField = z.string().trim().min(1).max(MAX_NOTE_LENGTH);
const ratingField = z
  .number({ error: "rating は数値(1〜5の整数)で指定してください" })
  .int("rating は整数で指定してください")
  .min(MIN_RATING, `rating は${MIN_RATING}〜${MAX_RATING}の整数にしてください(${MAX_RATING}が最良)`)
  .max(MAX_RATING, `rating は${MIN_RATING}〜${MAX_RATING}の整数にしてください(${MAX_RATING}が最良)`);

const SEAT_CLASS_DESCRIPTION = `席種(プレミアムシート、内野指定席、ボックスシート、外野自由席など。${MAX_SEAT_CLASS_LENGTH}文字まで)。任意。座席番号(seat)とは別に、その席の種類を入れる。空文字は未指定として扱う`;

const TITLE_DESCRIPTION = `作品名・公演名(映画のタイトル、ライブ名など。${MAX_TITLE_LENGTH}文字まで)。任意。会場・スクリーン・座席とは別に、そのときの催しの名前を入れる。明細の品名とは別物。空文字は未指定として扱う`;

export const seatRecordFieldsSchema = z.strictObject({
  date: isoDate.describe("鑑賞・利用した日(YYYY-MM-DD)。必須"),
  title: titleField.optional().describe(TITLE_DESCRIPTION),
  venue: venueField.describe(`会場名(映画館・劇場・ライブ会場など。${MAX_VENUE_LENGTH}文字まで)。必須。無ければ新しい会場として自動で作られる。表記ゆれを避けるため、登録前に list_venues で既存の会場を確かめて同じ名前を使い、新しい名前を作る前にユーザーに確認する`),
  screen: screenField.optional().describe(`スクリーン名・ホール名・エリア名(例: スクリーン5、シアター3、内野エリア。映画館のスクリーンだけでなく、ホール・ブロック・エリアなどの区画にも使える。${MAX_SCREEN_LENGTH}文字まで)。任意。その会場の下に、無ければ自動で作られる。list_venues で既存のスクリーンを確かめて同じ名前を使う`),
  seat: seatField.describe(`座席(例: F-5、J列12番。${MAX_SEAT_LENGTH}文字まで)。必須`),
  seat_class: seatClassField.optional().describe(SEAT_CLASS_DESCRIPTION),
  rating: ratingField.optional().describe(`席の評価(整数の${MIN_RATING}〜${MAX_RATING}。${MAX_RATING}が最良)。座席の座り心地・見やすさの評価で、作品の感想ではない。任意。ユーザーが席について言った感想から決める`),
  work_rating: ratingField.optional().describe(`作品の評価(整数の${MIN_RATING}〜${MAX_RATING}。${MAX_RATING}が最良)。映画やライブそのものの感想で、席の評価(rating)とは別。任意。ユーザーが言っていなければ省略する(勝手に決めない)`),
  note: noteField.optional().describe(`一言の感想(${MAX_NOTE_LENGTH}文字まで。例「前すぎて首が疲れた」)。任意`),
  poster_url: posterUrlField.optional().describe(POSTER_DESCRIPTION),
  transaction_id: idField.optional().describe("紐づける取引の id(チケット代の取引など。list_transactions や add_transactions の結果で分かる)。任意"),
});
export const newSeatRecordSchema = seatRecordFieldsSchema;
export type NewSeatRecord = z.infer<typeof newSeatRecordSchema>;

// 更新用。省略した項目は変えない。screen / rating / note / transaction_id は null で消去できる
export const updateSeatRecordFieldsSchema = z.strictObject({
  id: idField.describe("更新する座席の記録の id(list_seat_records で分かる)。必須"),
  date: isoDate.optional().describe("新しい日付(YYYY-MM-DD)。省略すると変えない"),
  title: titleField.nullable().optional().describe("新しい作品名・公演名(映画のタイトル、ライブ名など)。null か空文字で消去。省略すると変えない"),
  venue: venueField.optional().describe("新しい会場名(無ければ自動で作る。既存の会場の名前にそろえる)。省略すると変えない"),
  screen: screenField.nullable().optional().describe("新しいスクリーン名(その会場の下に、無ければ自動で作る)。null で消去。省略すると変えない"),
  seat: seatField.optional().describe("新しい座席。省略すると変えない"),
  seat_class: seatClassField.nullable().optional().describe("新しい席種(プレミアムシート、内野指定席など)。null か空文字で消去。省略すると変えない"),
  rating: ratingField.nullable().optional().describe(`新しい席の評価(${MIN_RATING}〜${MAX_RATING}の整数。作品の感想ではない)。null で消去。省略すると変えない`),
  work_rating: ratingField.nullable().optional().describe(`新しい作品の評価(${MIN_RATING}〜${MAX_RATING}の整数)。null で消去。省略すると変えない`),
  note: noteField.nullable().optional().describe("新しい一言。null で消去。省略すると変えない"),
  poster_url: posterUrlField.nullable().optional().describe("新しいポスター画像のURL(https)。null か空文字で消去。省略すると変えない"),
  transaction_id: idField.nullable().optional().describe("新しい紐づけ先の取引 id。null で紐づけを外す。省略すると変えない"),
});

export const deleteSeatRecordSchema = z.strictObject({ id: idField.describe("削除する座席の記録の id(list_seat_records で分かる)。必須") });

export const listSeatRecordsFieldsSchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional().describe("言葉で探す(作品名・会場・スクリーン・座席・席種・一言のどれかに部分一致。空白で区切ると、すべてを含むものに絞る)"),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional().describe("この作品名・公演名の記録だけ(部分一致。映画のタイトル、ライブ名など。例: 「ダミー作品」)"),
  venue: venueField.optional().describe("この会場の記録だけ(完全一致)。list_seat_records を絞らずに呼ぶと、既存の会場名が summary で分かる"),
  screen: screenField.optional().describe("このスクリーン名・ホール名の記録だけ(完全一致)"),
  seat: seatField.optional().describe("この座席の記録だけ(完全一致。例: F-5)"),
  seat_class: z.string().trim().min(1).max(MAX_SEAT_CLASS_LENGTH).optional().describe("この席種の記録だけ(部分一致。例: 「プレミアム」「内野指定席」)"),
  min_rating: ratingField.optional().describe(`この評価以上の記録だけ(${MIN_RATING}〜${MAX_RATING})。評価のない記録は除かれる`),
  min_work_rating: ratingField.optional().describe(`作品の評価がこの値以上の記録だけ(${MIN_RATING}〜${MAX_RATING})。作品の評価のない記録は除かれる`),
  max_rating: ratingField.optional().describe(`この評価以下の記録だけ(${MIN_RATING}〜${MAX_RATING})。評価のない記録は除かれる`),
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)"),
  to: isoDate.optional().describe("この日以前(YYYY-MM-DD)"),
  transaction_id: idField.optional().describe("この取引に紐づく記録だけ"),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT).describe(`records の最大件数(既定${DEFAULT_LIST_LIMIT}、最大${MAX_LIST_LIMIT})。件数 count と summary は、上限に関わらず絞り込みに合う全件で数える`),
  offset: z.number().int().min(0).max(100_000).default(0).describe("先頭から飛ばす件数(ページ送り用。例: limit 24 の2ページ目は offset 24)"),
});

// ---- 保存・取得 ----

// 会場・スクリーンを JOIN した読み取り用の SELECT(venue / screen は名前、venue_id / screen_id は id)
const VIEW_SELECT = `SELECT r.id, r.date, r.title, v.name AS venue, r.venue_id, s.name AS screen, r.screen_id, s.note AS screen_note,
       r.seat, r.seat_class, r.rating, r.work_rating, r.note, r.poster_url, r.transaction_id, r.created_at
  FROM seat_records r
  JOIN venues v ON v.id = r.venue_id
  LEFT JOIN screens s ON s.id = r.screen_id`;

// created_venue / created_screen: この登録で会場・スクリーンを新規に作ったか(AIが表記ゆれに気づくため)
export interface CreatedFlags {
  created_venue: boolean;
  created_screen: boolean;
}

export type SeatRecordResult = ({ ok: true; seat_record: SeatRecordView; message: string } & CreatedFlags) | { ok: false; errors: FieldError[] };
export type DeleteSeatRecordResult = { ok: true; deleted: SeatRecordView; message: string } | { ok: false; errors: FieldError[] };
export type ListSeatRecordsResult =
  | {
      ok: true;
      // 絞り込みに合う全件の数(records は limit まで)
      count: number;
      records: SeatRecordView[];
      summary: SeatSummaryRow[];
      // 絞り込みの候補(全件から): venues=会場名、years=日付の年(新しい順)
      facets: { venues: string[]; years: string[] };
      truncated: boolean;
      message: string;
    }
  | { ok: false; errors: FieldError[] };

const notFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: 「${id.slice(0, 64)}」という座席の記録はありません。list_seat_records で id を確かめてください` }],
});

const label = (r: Pick<SeatRecordView, "date" | "title" | "venue" | "screen" | "seat" | "seat_class" | "rating">) =>
  `${r.date}${r.title ? ` 「${r.title}」` : ""} ${r.venue}${r.screen ? ` ${r.screen}` : ""} ${r.seat}${r.seat_class ? `(${r.seat_class})` : ""}${r.rating ? `(★${r.rating})` : ""}`;

// 新規に作った会場・スクリーンを知らせる文。AIが、既存の表記と違う名前を作っていないか気づくための注意つき
function createdNotice(venue: string, screen: string | null, flags: CreatedFlags): string {
  const parts: string[] = [];
  if (flags.created_venue) parts.push(`会場「${venue}」を新規に作りました`);
  if (flags.created_screen && screen) parts.push(`スクリーン「${screen}」を新規に作りました`);
  if (parts.length === 0) return "";
  return `。${parts.join("。")}(既存の表記と違うなら、list_venues で確かめて update_seat_record で直してください)`;
}

export async function getSeatRecord(db: D1Database, id: string): Promise<SeatRecordView | null> {
  return db.prepare(`${VIEW_SELECT} WHERE r.id = ?`).bind(id).first<SeatRecordView>();
}

export async function addSeatRecord(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<SeatRecordResult> {
  const parsed = newSeatRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const errors = await checkRefs(db, m);
  if (errors.length > 0) return { ok: false, errors };

  const venue = await findOrCreateVenue(db, m.venue, options);
  const screen = m.screen === undefined ? null : await findOrCreateScreen(db, venue.id, m.screen, options);
  const flags: CreatedFlags = { created_venue: venue.created, created_screen: screen?.created ?? false };

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO seat_records (id, date, title, venue_id, screen_id, seat, seat_class, rating, work_rating, note, poster_url, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, m.date, m.title || null, venue.id, screen?.id ?? null, m.seat, m.seat_class || null, m.rating ?? null, m.work_rating ?? null, m.note ?? null, m.poster_url || null, m.transaction_id ?? null, (options.now ?? new Date()).toISOString())
    .run();
  const record = (await getSeatRecord(db, id))!;
  return { ok: true, seat_record: record, ...flags, message: `座席の記録を登録しました: ${label(record)}${createdNotice(record.venue, record.screen, flags)}` };
}

export async function updateSeatRecord(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<SeatRecordResult> {
  const parsed = updateSeatRecordFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, ...changes } = parsed.data;

  const current = await getSeatRecord(db, id);
  if (!current) return notFound(id);
  if (Object.values(changes).every((v) => v === undefined)) {
    return {
      ok: false,
      errors: [{ field: "input", message: "input: 更新する項目(date / title / venue / screen / seat / seat_class / rating / work_rating / note / poster_url / transaction_id)を1つ以上指定してください" }],
    };
  }
  if (changes.transaction_id) {
    const errors = await checkRefs(db, { transaction_id: changes.transaction_id });
    if (errors.length > 0) return { ok: false, errors };
  }

  // 会場・スクリーンは名前で解決する。venue だけ変えて screen を省略したときは、同じスクリーン名を新しい会場の下で探す(無ければ作る)
  const venueName = changes.venue ?? current.venue;
  const screenName = changes.screen === undefined ? current.screen : changes.screen;
  const placeChanged = changes.venue !== undefined || changes.screen !== undefined;
  let venueId = current.venue_id;
  let screenId = current.screen_id;
  const flags: CreatedFlags = { created_venue: false, created_screen: false };
  if (placeChanged) {
    const venue = await findOrCreateVenue(db, venueName, options);
    venueId = venue.id;
    flags.created_venue = venue.created;
    if (screenName === null) {
      screenId = null;
    } else {
      const screen = await findOrCreateScreen(db, venue.id, screenName, options);
      screenId = screen.id;
      flags.created_screen = screen.created;
    }
  }

  // 指定のない項目は、既存の値を保つ
  await db
    .prepare("UPDATE seat_records SET date = ?, title = ?, venue_id = ?, screen_id = ?, seat = ?, seat_class = ?, rating = ?, work_rating = ?, note = ?, poster_url = ?, transaction_id = ? WHERE id = ?")
    .bind(
      changes.date ?? current.date,
      // null と空文字は消去
      changes.title === undefined ? current.title : changes.title || null,
      venueId,
      screenId,
      changes.seat ?? current.seat,
      changes.seat_class === undefined ? current.seat_class : changes.seat_class || null,
      changes.rating === undefined ? current.rating : changes.rating,
      changes.work_rating === undefined ? current.work_rating : changes.work_rating,
      changes.note === undefined ? current.note : changes.note,
      changes.poster_url === undefined ? current.poster_url : changes.poster_url || null,
      changes.transaction_id === undefined ? current.transaction_id : changes.transaction_id,
      id,
    )
    .run();
  // 移して空になった会場・スクリーンは片づける(名前の直しで、古い表記が候補に残らないように)
  if (placeChanged) await pruneEmptyVenues(db);
  const next = (await getSeatRecord(db, id))!;
  return { ok: true, seat_record: next, ...flags, message: `座席の記録を更新しました: ${label(next)}${createdNotice(next.venue, next.screen, flags)}` };
}

export async function deleteSeatRecord(db: D1Database, input: unknown): Promise<DeleteSeatRecordResult> {
  const parsed = deleteSeatRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const current = await getSeatRecord(db, id);
  if (!current) return notFound(id);
  await db.prepare("DELETE FROM seat_records WHERE id = ?").bind(id).run();
  await pruneEmptyVenues(db);
  return { ok: true, deleted: current, message: `座席の記録を削除しました: ${label(current)}` };
}

// その日の記録(日の詳細用)。登録順
export async function listSeatRecordsOnDay(db: D1Database, date: string): Promise<SeatRecordView[]> {
  const { results } = await db.prepare(`${VIEW_SELECT} WHERE r.date = ? ORDER BY r.created_at, r.id`).bind(date).all<SeatRecordView>();
  return results;
}

// 絞り込み(すべて AND)。並びは date の新しい順(同じ日は登録の新しい順)。venue / screen は名前の完全一致
export async function listSeatRecords(db: D1Database, input: unknown): Promise<ListSeatRecordsResult> {
  const parsed = listSeatRecordsFieldsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  if (m.from && m.to && m.from > m.to) return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };
  if (m.min_rating !== undefined && m.max_rating !== undefined && m.min_rating > m.max_rating) {
    return { ok: false, errors: [{ field: "min_rating", message: "min_rating: min_rating は max_rating 以下にしてください" }] };
  }

  const where: string[] = [];
  const binds: (string | number)[] = [];
  const add = (sql: string, value: string | number | undefined) => {
    if (value === undefined) return;
    where.push(sql);
    binds.push(value);
  };
  // 言葉は空白で区切り、すべてを含むものに絞る(各語は、いずれかの列に部分一致)
  for (const word of (m.q ?? "").split(/\s+/).filter(Boolean)) {
    const like = `%${escapeLike(word)}%`;
    where.push("(r.title LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR r.seat LIKE ? ESCAPE '\\' OR r.seat_class LIKE ? ESCAPE '\\' OR r.note LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like, like, like);
  }
  if (m.title !== undefined) {
    where.push("r.title LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(m.title)}%`);
  }
  if (m.seat_class !== undefined) {
    where.push("r.seat_class LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(m.seat_class)}%`);
  }
  add("v.name = ?", m.venue);
  add("s.name = ?", m.screen);
  add("r.seat = ?", m.seat);
  add("r.rating >= ?", m.min_rating);
  add("r.work_rating >= ?", m.min_work_rating);
  add("r.rating <= ?", m.max_rating);
  add("r.date >= ?", m.from);
  add("r.date <= ?", m.to);
  add("r.transaction_id = ?", m.transaction_id);
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const from = "FROM seat_records r JOIN venues v ON v.id = r.venue_id LEFT JOIN screens s ON s.id = r.screen_id";

  const [rows, total, summary, venueList, yearList] = await Promise.all([
    db
      .prepare(`${VIEW_SELECT} ${clause} ORDER BY r.date DESC, r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, m.limit, m.offset)
      .all<SeatRecordView>(),
    db.prepare(`SELECT COUNT(*) AS n ${from} ${clause}`).bind(...binds).first<{ n: number }>(),
    db
      .prepare(
        `SELECT v.name AS venue, s.name AS screen, r.seat, COUNT(*) AS count, COUNT(r.rating) AS rated_count, ROUND(AVG(r.rating), 1) AS avg_rating
         ${from} ${clause}
         GROUP BY v.name, s.name, r.seat
         ORDER BY v.name, s.name, r.seat
         LIMIT ?`,
      )
      .bind(...binds, MAX_SUMMARY_ROWS)
      .all<SeatSummaryRow>(),
    db.prepare("SELECT DISTINCT v.name AS v FROM seat_records r JOIN venues v ON v.id = r.venue_id ORDER BY v.name LIMIT 200").all<{ v: string }>(),
    db.prepare("SELECT DISTINCT substr(date, 1, 4) AS v FROM seat_records ORDER BY v DESC LIMIT 50").all<{ v: string }>(),
  ]);
  const count = total?.n ?? 0;
  const truncated = m.offset + rows.results.length < count;
  return {
    ok: true,
    count,
    records: rows.results,
    summary: summary.results,
    facets: { venues: venueList.results.map((r) => r.v), years: yearList.results.map((r) => r.v) },
    truncated,
    message: count === 0 ? "該当する座席の記録はありません" : `${count}件の座席の記録があります${truncated || m.offset > 0 ? `(新しい順に、${m.offset + 1}〜${m.offset + rows.results.length}件目を返しました)` : ""}`,
  };
}
