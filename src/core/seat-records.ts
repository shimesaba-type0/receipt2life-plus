import { z } from "zod";
import { checkRefs } from "./photos";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import { escapeLike, type CoreOptions } from "./transactions";

// 座席の記録(seat_records)。映画館のスクリーン・座席など、会場の席の評価を構造化して残し、次に席を選ぶ参考にする。
// 映画以外(劇場、ライブ会場など)にも使える名前にしてある: venue=会場、screen=スクリーン/ホール、seat=座席。
// title=作品名・公演名(映画のタイトル、ライブ名など。任意。明細の品名とは別物)。取引の列は増やさず、取引への紐づけ(transaction_id)は任意。

export const MAX_VENUE_LENGTH = 100;
export const MAX_TITLE_LENGTH = 100;
export const MAX_SCREEN_LENGTH = 100;
export const MAX_SEAT_LENGTH = 50;
export const MAX_NOTE_LENGTH = 200;
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
  venue: string;
  screen: string | null;
  seat: string;
  rating: number | null;
  note: string | null;
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

const idField = z.string().min(1).max(100);
const venueField = z.string().trim().min(1).max(MAX_VENUE_LENGTH);
const screenField = z.string().trim().min(1).max(MAX_SCREEN_LENGTH);
// 空文字(空白だけを含む)は未指定扱い: 追加では NULL、更新では消去。保存の前に normalizeTitle で整える
const titleField = z.string().trim().max(MAX_TITLE_LENGTH);
const seatField = z.string().trim().min(1).max(MAX_SEAT_LENGTH);
const noteField = z.string().trim().min(1).max(MAX_NOTE_LENGTH);
const ratingField = z
  .number({ error: "rating は数値(1〜5の整数)で指定してください" })
  .int("rating は整数で指定してください")
  .min(MIN_RATING, `rating は${MIN_RATING}〜${MAX_RATING}の整数にしてください(${MAX_RATING}が最良)`)
  .max(MAX_RATING, `rating は${MIN_RATING}〜${MAX_RATING}の整数にしてください(${MAX_RATING}が最良)`);

const TITLE_DESCRIPTION = `作品名・公演名(映画のタイトル、ライブ名など。${MAX_TITLE_LENGTH}文字まで)。任意。会場・スクリーン・座席とは別に、そのときの催しの名前を入れる。明細の品名とは別物。空文字は未指定として扱う`;

export const seatRecordFieldsSchema = z.strictObject({
  date: isoDate.describe("鑑賞・利用した日(YYYY-MM-DD)。必須"),
  title: titleField.optional().describe(TITLE_DESCRIPTION),
  venue: venueField.describe(`会場名(映画館・劇場・ライブ会場など。${MAX_VENUE_LENGTH}文字まで)。必須。表記ゆれを避けるため、登録前に list_seat_records で既存の会場名を確かめて同じ表記にそろえる`),
  screen: screenField.optional().describe(`スクリーン名・ホール名(例: スクリーン5、シアター3。${MAX_SCREEN_LENGTH}文字まで)。任意。既存の表記にそろえる`),
  seat: seatField.describe(`座席(例: F-5、J列12番。${MAX_SEAT_LENGTH}文字まで)。必須`),
  rating: ratingField.optional().describe(`席の評価(整数の${MIN_RATING}〜${MAX_RATING}。${MAX_RATING}が最良)。任意。ユーザーが言った感想から決める`),
  note: noteField.optional().describe(`一言の感想(${MAX_NOTE_LENGTH}文字まで。例「前すぎて首が疲れた」)。任意`),
  transaction_id: idField.optional().describe("紐づける取引の id(チケット代の取引など。list_transactions や add_transactions の結果で分かる)。任意"),
});
export const newSeatRecordSchema = seatRecordFieldsSchema;
export type NewSeatRecord = z.infer<typeof newSeatRecordSchema>;

// 更新用。省略した項目は変えない。screen / rating / note / transaction_id は null で消去できる
export const updateSeatRecordFieldsSchema = z.strictObject({
  id: idField.describe("更新する座席の記録の id(list_seat_records で分かる)。必須"),
  date: isoDate.optional().describe("新しい日付(YYYY-MM-DD)。省略すると変えない"),
  title: titleField.nullable().optional().describe("新しい作品名・公演名(映画のタイトル、ライブ名など)。null か空文字で消去。省略すると変えない"),
  venue: venueField.optional().describe("新しい会場名。省略すると変えない"),
  screen: screenField.nullable().optional().describe("新しいスクリーン名。null で消去。省略すると変えない"),
  seat: seatField.optional().describe("新しい座席。省略すると変えない"),
  rating: ratingField.nullable().optional().describe(`新しい評価(${MIN_RATING}〜${MAX_RATING}の整数)。null で消去。省略すると変えない`),
  note: noteField.nullable().optional().describe("新しい一言。null で消去。省略すると変えない"),
  transaction_id: idField.nullable().optional().describe("新しい紐づけ先の取引 id。null で紐づけを外す。省略すると変えない"),
});

export const deleteSeatRecordSchema = z.strictObject({ id: idField.describe("削除する座席の記録の id(list_seat_records で分かる)。必須") });

export const listSeatRecordsFieldsSchema = z.strictObject({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional().describe("この作品名・公演名の記録だけ(部分一致。映画のタイトル、ライブ名など。例: 「ダミー作品」)"),
  venue: venueField.optional().describe("この会場の記録だけ(完全一致)。list_seat_records を絞らずに呼ぶと、既存の会場名が summary で分かる"),
  screen: screenField.optional().describe("このスクリーン名・ホール名の記録だけ(完全一致)"),
  seat: seatField.optional().describe("この座席の記録だけ(完全一致。例: F-5)"),
  min_rating: ratingField.optional().describe(`この評価以上の記録だけ(${MIN_RATING}〜${MAX_RATING})。評価のない記録は除かれる`),
  max_rating: ratingField.optional().describe(`この評価以下の記録だけ(${MIN_RATING}〜${MAX_RATING})。評価のない記録は除かれる`),
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)"),
  to: isoDate.optional().describe("この日以前(YYYY-MM-DD)"),
  transaction_id: idField.optional().describe("この取引に紐づく記録だけ"),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT).describe(`records の最大件数(既定${DEFAULT_LIST_LIMIT}、最大${MAX_LIST_LIMIT})。件数 count と summary は、上限に関わらず絞り込みに合う全件で数える`),
});

// ---- 保存・取得 ----

const COLUMNS = "id, date, title, venue, screen, seat, rating, note, transaction_id, created_at";

export type SeatRecordResult = { ok: true; seat_record: SeatRecordView; message: string } | { ok: false; errors: FieldError[] };
export type DeleteSeatRecordResult = { ok: true; deleted: SeatRecordView; message: string } | { ok: false; errors: FieldError[] };
export type ListSeatRecordsResult =
  | {
      ok: true;
      // 絞り込みに合う全件の数(records は limit まで)
      count: number;
      records: SeatRecordView[];
      summary: SeatSummaryRow[];
      truncated: boolean;
      message: string;
    }
  | { ok: false; errors: FieldError[] };

const notFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: 「${id.slice(0, 64)}」という座席の記録はありません。list_seat_records で id を確かめてください` }],
});

const label = (r: Pick<SeatRecordView, "date" | "title" | "venue" | "screen" | "seat" | "rating">) =>
  `${r.date}${r.title ? ` 「${r.title}」` : ""} ${r.venue}${r.screen ? ` ${r.screen}` : ""} ${r.seat}${r.rating ? `(★${r.rating})` : ""}`;

export async function addSeatRecord(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<SeatRecordResult> {
  const parsed = newSeatRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const errors = await checkRefs(db, m);
  if (errors.length > 0) return { ok: false, errors };

  const record: SeatRecordView = {
    id: crypto.randomUUID(),
    date: m.date,
    title: m.title || null,
    venue: m.venue,
    screen: m.screen ?? null,
    seat: m.seat,
    rating: m.rating ?? null,
    note: m.note ?? null,
    transaction_id: m.transaction_id ?? null,
    created_at: (options.now ?? new Date()).toISOString(),
  };
  await db
    .prepare(`INSERT INTO seat_records (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.id, record.date, record.title, record.venue, record.screen, record.seat, record.rating, record.note, record.transaction_id, record.created_at)
    .run();
  return { ok: true, seat_record: record, message: `座席の記録を登録しました: ${label(record)}` };
}

export async function updateSeatRecord(db: D1Database, input: unknown): Promise<SeatRecordResult> {
  const parsed = updateSeatRecordFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, ...changes } = parsed.data;

  const current = await db.prepare(`SELECT ${COLUMNS} FROM seat_records WHERE id = ?`).bind(id).first<SeatRecordView>();
  if (!current) return notFound(id);
  if (Object.values(changes).every((v) => v === undefined)) {
    return {
      ok: false,
      errors: [{ field: "input", message: "input: 更新する項目(date / title / venue / screen / seat / rating / note / transaction_id)を1つ以上指定してください" }],
    };
  }
  if (changes.transaction_id) {
    const errors = await checkRefs(db, { transaction_id: changes.transaction_id });
    if (errors.length > 0) return { ok: false, errors };
  }

  // 指定のない項目は、既存の値を保つ
  const next: SeatRecordView = {
    id,
    date: changes.date ?? current.date,
    // null と空文字は消去
    title: changes.title === undefined ? current.title : changes.title || null,
    venue: changes.venue ?? current.venue,
    screen: changes.screen === undefined ? current.screen : changes.screen,
    seat: changes.seat ?? current.seat,
    rating: changes.rating === undefined ? current.rating : changes.rating,
    note: changes.note === undefined ? current.note : changes.note,
    transaction_id: changes.transaction_id === undefined ? current.transaction_id : changes.transaction_id,
    created_at: current.created_at,
  };
  await db
    .prepare("UPDATE seat_records SET date = ?, title = ?, venue = ?, screen = ?, seat = ?, rating = ?, note = ?, transaction_id = ? WHERE id = ?")
    .bind(next.date, next.title, next.venue, next.screen, next.seat, next.rating, next.note, next.transaction_id, id)
    .run();
  return { ok: true, seat_record: next, message: `座席の記録を更新しました: ${label(next)}` };
}

export async function deleteSeatRecord(db: D1Database, input: unknown): Promise<DeleteSeatRecordResult> {
  const parsed = deleteSeatRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const current = await db.prepare(`SELECT ${COLUMNS} FROM seat_records WHERE id = ?`).bind(id).first<SeatRecordView>();
  if (!current) return notFound(id);
  await db.prepare("DELETE FROM seat_records WHERE id = ?").bind(id).run();
  return { ok: true, deleted: current, message: `座席の記録を削除しました: ${label(current)}` };
}

// その日の記録(日の詳細用)。登録順
export async function listSeatRecordsOnDay(db: D1Database, date: string): Promise<SeatRecordView[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM seat_records WHERE date = ? ORDER BY created_at, id`).bind(date).all<SeatRecordView>();
  return results;
}

// 絞り込み(すべて AND)。並びは date の新しい順(同じ日は登録の新しい順)
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
  if (m.title !== undefined) {
    where.push("title LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(m.title)}%`);
  }
  add("venue = ?", m.venue);
  add("screen = ?", m.screen);
  add("seat = ?", m.seat);
  add("rating >= ?", m.min_rating);
  add("rating <= ?", m.max_rating);
  add("date >= ?", m.from);
  add("date <= ?", m.to);
  add("transaction_id = ?", m.transaction_id);
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, total, summary] = await Promise.all([
    db
      .prepare(`SELECT ${COLUMNS} FROM seat_records ${clause} ORDER BY date DESC, created_at DESC, id DESC LIMIT ?`)
      .bind(...binds, m.limit)
      .all<SeatRecordView>(),
    db.prepare(`SELECT COUNT(*) AS n FROM seat_records ${clause}`).bind(...binds).first<{ n: number }>(),
    db
      .prepare(
        `SELECT venue, screen, seat, COUNT(*) AS count, COUNT(rating) AS rated_count, ROUND(AVG(rating), 1) AS avg_rating
         FROM seat_records ${clause}
         GROUP BY venue, screen, seat
         ORDER BY venue, screen, seat
         LIMIT ?`,
      )
      .bind(...binds, MAX_SUMMARY_ROWS)
      .all<SeatSummaryRow>(),
  ]);
  const count = total?.n ?? 0;
  const truncated = count > rows.results.length;
  return {
    ok: true,
    count,
    records: rows.results,
    summary: summary.results,
    truncated,
    message: count === 0 ? "該当する座席の記録はありません" : `${count}件の座席の記録があります${truncated ? `(新しい順に${rows.results.length}件を返しました)` : ""}`,
  };
}
