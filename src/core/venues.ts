import { z } from "zod";
import { toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

// 会場(venues)とスクリーン(screens)。座席の記録(seat_records)から別のレコードに分けてある。
// 会場名は重複しない(完全一致)。スクリーンは会場の下にあり、(会場, スクリーン名)は重複しない。
// スクリーンの note は「そのスクリーンの特徴」(例: 前方は首が疲れる)。座席の記録は venue / screen を名前で受けて、無ければ作る(find-or-create)。
// 削除用のツール・APIは作らない。記録も note もない会場・スクリーンは、座席の記録を直す・消すときに自動で片づく(pruneEmptyVenues)。

export const MAX_VENUE_LENGTH = 100;
export const MAX_SCREEN_LENGTH = 100;
export const MAX_SCREEN_NOTE_LENGTH = 200;

export interface ScreenView {
  id: string;
  venue_id: string;
  name: string;
  note: string | null;
  created_at: string;
}

// 席選びの参考用の集計つき。avg_rating は評価のある記録の平均(小数1桁。評価がなければ null)
export interface ScreenSummary {
  id: string;
  name: string;
  note: string | null;
  record_count: number;
  rated_count: number;
  avg_rating: number | null;
}

export interface VenueSummary {
  id: string;
  name: string;
  // 会場の全記録(スクリーン未指定の記録を含む)
  record_count: number;
  rated_count: number;
  avg_rating: number | null;
  screens: ScreenSummary[];
}

// ---- スキーマ(MCP の入力定義・API の検証・型を兼ねる) ----

const idField = z.string().min(1).max(100);
export const venueNameField = z.string().trim().min(1).max(MAX_VENUE_LENGTH);
export const screenNameField = z.string().trim().min(1).max(MAX_SCREEN_LENGTH);
// 空文字(空白だけを含む)は消去として扱う
const screenNoteField = z.string().trim().max(MAX_SCREEN_NOTE_LENGTH);

export const updateVenueSchema = z.strictObject({
  id: idField.describe("会場の id(list_venues で分かる)。必須"),
  name: venueNameField.describe(`新しい会場名(${MAX_VENUE_LENGTH}文字まで)。必須。同じ名前の会場が既にあるとエラー`),
});

export const updateScreenSchema = z.strictObject({
  id: idField.describe("スクリーンの id(list_venues で分かる)。必須"),
  name: screenNameField.optional().describe(`新しいスクリーン名(${MAX_SCREEN_LENGTH}文字まで)。同じ会場に同じ名前があるとエラー。省略すると変えない`),
  note: screenNoteField
    .nullable()
    .optional()
    .describe(`そのスクリーンの特徴(${MAX_SCREEN_NOTE_LENGTH}文字まで。例「前方は首が疲れる」「後方の段差が見やすい」)。null か空文字で消去。省略すると変えない`),
});

// ---- find-or-create(完全一致。名前は前後の空白を除いてから比べる) ----

export interface VenueRef {
  id: string;
  name: string;
}

// 会場を名前で探す。無ければ作る(created=true)。呼び出し側が検証済み(1〜100文字)の名前を渡す
export async function findOrCreateVenue(db: D1Database, rawName: string, options: CoreOptions = {}): Promise<VenueRef & { created: boolean }> {
  const name = rawName.trim();
  const found = await db.prepare("SELECT id, name FROM venues WHERE name = ?").bind(name).first<VenueRef>();
  if (found) return { ...found, created: false };
  const id = crypto.randomUUID();
  const createdAt = (options.now ?? new Date()).toISOString();
  // 同時に同じ名前が作られても、UNIQUE で1件に保つ(後から探し直す)
  await db.prepare("INSERT OR IGNORE INTO venues (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, createdAt).run();
  const row = await db.prepare("SELECT id, name FROM venues WHERE name = ?").bind(name).first<VenueRef>();
  return { id: row!.id, name, created: row!.id === id };
}

export async function findOrCreateScreen(
  db: D1Database,
  venueId: string,
  rawName: string,
  options: CoreOptions = {},
): Promise<{ id: string; name: string; created: boolean }> {
  const name = rawName.trim();
  const found = await db.prepare("SELECT id FROM screens WHERE venue_id = ? AND name = ?").bind(venueId, name).first<{ id: string }>();
  if (found) return { id: found.id, name, created: false };
  const id = crypto.randomUUID();
  const createdAt = (options.now ?? new Date()).toISOString();
  await db.prepare("INSERT OR IGNORE INTO screens (id, venue_id, name, note, created_at) VALUES (?, ?, ?, NULL, ?)").bind(id, venueId, name, createdAt).run();
  const row = await db.prepare("SELECT id FROM screens WHERE venue_id = ? AND name = ?").bind(venueId, name).first<{ id: string }>();
  return { id: row!.id, name, created: row!.id === id };
}

// 記録も note もないスクリーンと、スクリーンも記録もない会場を消す(名前だけの残骸が候補に残らないように)
export async function pruneEmptyVenues(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM screens WHERE note IS NULL AND NOT EXISTS (SELECT 1 FROM seat_records r WHERE r.screen_id = screens.id)"),
    db.prepare(
      "DELETE FROM venues WHERE NOT EXISTS (SELECT 1 FROM seat_records r WHERE r.venue_id = venues.id) AND NOT EXISTS (SELECT 1 FROM screens s WHERE s.venue_id = venues.id)",
    ),
  ]);
}

// ---- 一覧 ----

export type ListVenuesResult = { ok: true; count: number; venues: VenueSummary[]; message: string };

export async function listVenues(db: D1Database): Promise<ListVenuesResult> {
  const [venueRows, screenRows] = await Promise.all([
    db
      .prepare(
        `SELECT v.id, v.name, COUNT(r.id) AS record_count, COUNT(r.rating) AS rated_count, ROUND(AVG(r.rating), 1) AS avg_rating
         FROM venues v LEFT JOIN seat_records r ON r.venue_id = v.id
         GROUP BY v.id ORDER BY v.name, v.id`,
      )
      .all<Omit<VenueSummary, "screens">>(),
    db
      .prepare(
        `SELECT s.id, s.venue_id, s.name, s.note, COUNT(r.id) AS record_count, COUNT(r.rating) AS rated_count, ROUND(AVG(r.rating), 1) AS avg_rating
         FROM screens s LEFT JOIN seat_records r ON r.screen_id = s.id
         GROUP BY s.id ORDER BY s.name, s.id`,
      )
      .all<ScreenSummary & { venue_id: string }>(),
  ]);
  const byVenue = new Map<string, ScreenSummary[]>();
  for (const { venue_id, ...screen } of screenRows.results) {
    const list = byVenue.get(venue_id) ?? [];
    list.push(screen);
    byVenue.set(venue_id, list);
  }
  const venues: VenueSummary[] = venueRows.results.map((v) => ({ ...v, screens: byVenue.get(v.id) ?? [] }));
  return {
    ok: true,
    count: venues.length,
    venues,
    message: venues.length === 0 ? "登録済みの会場はありません" : `${venues.length}件の会場があります`,
  };
}

// ---- 名前の変更・note ----

export type VenueResult = { ok: true; venue: VenueSummary; message: string } | { ok: false; errors: FieldError[] };
export type ScreenResult = { ok: true; screen: ScreenView; message: string } | { ok: false; errors: FieldError[] };

const venueNotFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: 「${id.slice(0, 64)}」という会場はありません。list_venues で id を確かめてください` }],
});
const screenNotFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: 「${id.slice(0, 64)}」というスクリーンはありません。list_venues で id を確かめてください` }],
});

async function venueSummary(db: D1Database, id: string): Promise<VenueSummary> {
  const all = await listVenues(db);
  return all.venues.find((v) => v.id === id)!;
}

export async function updateVenue(db: D1Database, input: unknown): Promise<VenueResult> {
  const parsed = updateVenueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, name } = parsed.data;
  const current = await db.prepare("SELECT id, name FROM venues WHERE id = ?").bind(id).first<VenueRef>();
  if (!current) return venueNotFound(id);
  if (current.name !== name) {
    const clash = await db.prepare("SELECT id FROM venues WHERE name = ? AND id != ?").bind(name, id).first();
    if (clash) {
      return {
        ok: false,
        errors: [
          {
            field: "name",
            message: `name: 会場「${name}」は既にあります。会場の統合はできません。座席の記録の venue を update_seat_record で直してください`,
          },
        ],
      };
    }
    await db.prepare("UPDATE venues SET name = ? WHERE id = ?").bind(name, id).run();
  }
  return {
    ok: true,
    venue: await venueSummary(db, id),
    message: current.name === name ? `会場の名前は変わりません: ${name}` : `会場の名前を変えました: ${current.name} → ${name}`,
  };
}

export async function updateScreen(db: D1Database, input: unknown): Promise<ScreenResult> {
  const parsed = updateScreenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, ...changes } = parsed.data;
  const current = await db.prepare("SELECT id, venue_id, name, note, created_at FROM screens WHERE id = ?").bind(id).first<ScreenView>();
  if (!current) return screenNotFound(id);
  if (changes.name === undefined && changes.note === undefined) {
    return { ok: false, errors: [{ field: "input", message: "input: 更新する項目(name / note)を1つ以上指定してください" }] };
  }
  const name = changes.name ?? current.name;
  // null と空文字は消去
  const note = changes.note === undefined ? current.note : changes.note || null;
  if (name !== current.name) {
    const clash = await db.prepare("SELECT id FROM screens WHERE venue_id = ? AND name = ? AND id != ?").bind(current.venue_id, name, id).first();
    if (clash) {
      return {
        ok: false,
        errors: [{ field: "name", message: `name: この会場に、スクリーン「${name}」は既にあります。スクリーンの統合はできません。座席の記録の screen を update_seat_record で直してください` }],
      };
    }
  }
  await db.prepare("UPDATE screens SET name = ?, note = ? WHERE id = ?").bind(name, note, id).run();
  const screen: ScreenView = { ...current, name, note };
  const parts: string[] = [];
  if (name !== current.name) parts.push(`名前を変えました: ${current.name} → ${name}`);
  if (note !== current.note) parts.push(note ? `特徴(note)を設定しました: ${note}` : "特徴(note)を消しました");
  return { ok: true, screen, message: `スクリーン「${name}」${parts.length > 0 ? parts.join("。") : "は変わりません"}` };
}
