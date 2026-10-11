import { z } from "zod";
import { COLORS, eventInputSchema, isoDate, toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

export interface EventView {
  id: string;
  start_date: string;
  end_date: string | null;
  title: string;
  note: string | null;
  color: string;
}

export type EventResult =
  | { ok: true; event: EventView; message: string }
  | { ok: false; errors: FieldError[] };

export type ListEventsResult =
  | { ok: true; events: EventView[]; count: number }
  | { ok: false; errors: FieldError[] };

// 更新用。eventFieldsSchema.partial() だと color の default("blue") が働いて、未指定でも青に戻ってしまうので別に作る
// end_date: null で期間を解除、note: null で消去
export const updateEventFieldsSchema = z.strictObject({
  id: z.string().min(1, "id は必須です").describe("更新する出来事のID(list_events で取れる)。必須"),
  title: z.string().trim().min(1, "title は空にできません").max(100).optional().describe("新しいタイトル。省略すると変えない"),
  start_date: isoDate.optional().describe("新しい開始日(YYYY-MM-DD)。省略すると変えない"),
  end_date: isoDate.nullable().optional().describe("新しい終了日(YYYY-MM-DD)。null で期間を解除して単日にする。省略すると変えない"),
  note: z.string().max(1000).nullable().optional().describe("新しいメモ。null で消去。省略すると変えない"),
  color: z.enum(COLORS).optional().describe("新しい色。red / orange / green / blue / purple のいずれか。省略すると変えない"),
});

export const listEventsSchema = z.strictObject({
  from: isoDate.optional().describe("この日以降に重なる出来事(YYYY-MM-DD)"),
  to: isoDate.optional().describe("この日以前に重なる出来事(YYYY-MM-DD)"),
  limit: z.number().int().min(1).max(500).default(100).describe("最大件数(既定100、最大500)"),
});

const COLUMNS = "id, start_date, end_date, title, note, color";

const period = (e: { start_date: string; end_date: string | null }) => (e.end_date ? `${e.start_date}〜${e.end_date}` : e.start_date);

export async function addEvent(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<EventResult> {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const e = parsed.data;

  const timestamp = (options.now ?? new Date()).toISOString();
  const event: EventView = {
    id: crypto.randomUUID(),
    start_date: e.start_date,
    end_date: e.end_date ?? null,
    title: e.title,
    note: e.note ?? null,
    color: e.color,
  };
  await db
    .prepare(`INSERT INTO events (${COLUMNS}, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(event.id, event.start_date, event.end_date, event.title, event.note, event.color, timestamp, timestamp)
    .run();
  return { ok: true, event, message: `出来事を登録しました: ${event.title} ${period(event)}(${event.color})` };
}

export async function updateEvent(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<EventResult> {
  const parsed = updateEventFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, ...changes } = parsed.data;

  const current = await db.prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?`).bind(id).first<EventView>();
  if (!current) {
    return { ok: false, errors: [{ field: "id", message: `id: 「${id}」という出来事はありません。list_events で id を確かめてください` }] };
  }
  if (Object.values(changes).every((v) => v === undefined)) {
    return { ok: false, errors: [{ field: "input", message: "input: 更新する項目(title / start_date / end_date / note / color)を1つ以上指定してください" }] };
  }

  // 指定のない項目は、既存の値を保つ
  const next: EventView = {
    id,
    title: changes.title ?? current.title,
    start_date: changes.start_date ?? current.start_date,
    end_date: changes.end_date === undefined ? current.end_date : changes.end_date,
    note: changes.note === undefined ? current.note : changes.note,
    color: changes.color ?? current.color,
  };
  if (next.end_date && next.end_date < next.start_date) {
    const hint = changes.end_date === undefined ? "(既存の終了日と合わせて検証しました。期間を解除するなら end_date に null を指定します)" : "";
    return {
      ok: false,
      errors: [{ field: "end_date", message: `end_date: end_date(${next.end_date})は start_date(${next.start_date})以降の日付にしてください${hint}` }],
    };
  }

  const timestamp = (options.now ?? new Date()).toISOString();
  await db
    .prepare("UPDATE events SET title = ?, start_date = ?, end_date = ?, note = ?, color = ?, updated_at = ? WHERE id = ?")
    .bind(next.title, next.start_date, next.end_date, next.note, next.color, timestamp, id)
    .run();
  return { ok: true, event: next, message: `出来事を更新しました: ${next.title} ${period(next)}(${next.color})` };
}

export type DeleteEventResult =
  | { ok: true; deleted: EventView; message: string }
  | { ok: false; errors: FieldError[] };

// UI 専用(MCP には出さない)。写真が紐づく出来事は、外部キーで落ちる前に、分かる文章で断る
export async function deleteEvent(db: D1Database, input: unknown): Promise<DeleteEventResult> {
  const parsed = z.strictObject({ id: z.string().min(1, "id は必須です") }).safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;

  const current = await db.prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?`).bind(id).first<EventView>();
  if (!current) return { ok: false, errors: [{ field: "id", message: `id: 「${id}」という出来事はありません` }] };

  const photos = await db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE event_id = ?").bind(id).first<{ n: number }>();
  if (photos && photos.n > 0) {
    return { ok: false, errors: [{ field: "id", message: `id: 写真が${photos.n}枚紐づいているため削除できません(${current.title})` }] };
  }
  // リンク(外部リンク)は軽いので、出来事といっしょに消す
  await db.batch([db.prepare("DELETE FROM links WHERE event_id = ?").bind(id), db.prepare("DELETE FROM events WHERE id = ?").bind(id)]);
  return { ok: true, deleted: current, message: `出来事を削除しました: ${current.title} ${period(current)}` };
}

export async function listEvents(db: D1Database, input: unknown): Promise<ListEventsResult> {
  const parsed = listEventsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { from, to, limit } = parsed.data;
  if (from && to && from > to) {
    return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };
  }

  // 出来事の範囲は start_date〜(end_date ?? start_date)。指定の期間と重なるものを返す
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (from) {
    where.push("COALESCE(end_date, start_date) >= ?");
    params.push(from);
  }
  if (to) {
    where.push("start_date <= ?");
    params.push(to);
  }
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM events
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY start_date, created_at, id
       LIMIT ?`,
    )
    .bind(...params, limit)
    .all<EventView>();
  return { ok: true, events: results, count: results.length };
}
