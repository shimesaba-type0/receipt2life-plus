import { z } from "zod";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

// 写真(attachments)。実体は R2、ここでは検証・保存・削除・参照の組み立てを行う

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";

export interface PhotoView {
  id: string;
  url: string;
  caption: string | null;
  date: string | null;
  transaction_id: string | null;
  event_id: string | null;
  created_at: string;
}

export type PhotoErrorStatus = 400 | 404 | 413;
export type PhotoFailure = { ok: false; status: PhotoErrorStatus; errors: FieldError[] };
export type PhotoResult = { ok: true; photo: PhotoView; message: string } | PhotoFailure;
export type DeletePhotoResult = { ok: true; deleted: PhotoView; message: string } | PhotoFailure;
export type GetPhotoResult = { ok: true; body: ReadableStream; contentType: PhotoMime; size: number } | PhotoFailure;

// 先頭のバイト列(マジックナンバー)で判定する。申告の Content-Type や拡張子は見ない
export function detectImageType(bytes: Uint8Array): PhotoMime | null {
  const at = (i: number, sig: number[]) => sig.every((b, k) => bytes[i + k] === b);
  if (bytes.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF" + 4バイト(サイズ) + "WEBP"
  if (bytes.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

const ALLOWED: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

// フォームの空欄("")は未指定として扱う
const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().min(1).max(max).optional());

export const photoMetaSchema = z
  .strictObject({
    date: z.preprocess(blankToUndefined, isoDate.optional()),
    transaction_id: optionalText(100),
    event_id: optionalText(100),
    caption: optionalText(200),
  })
  .refine((m) => m.date || m.transaction_id || m.event_id, {
    message: "date、transaction_id、event_id のうち1つ以上を指定してください",
    path: ["date"],
  });

const COLUMNS = "id, r2_key, date, transaction_id, event_id, caption, created_at";

interface PhotoRow {
  id: string;
  r2_key: string;
  date: string | null;
  transaction_id: string | null;
  event_id: string | null;
  caption: string | null;
  created_at: string;
}

export const photoUrl = (id: string) => `/api/photos/${id}`;

export function toPhotoView(row: Omit<PhotoRow, "r2_key">): PhotoView {
  return {
    id: row.id,
    url: photoUrl(row.id),
    caption: row.caption,
    date: row.date,
    transaction_id: row.transaction_id,
    event_id: row.event_id,
    created_at: row.created_at,
  };
}

const fail = (status: PhotoErrorStatus, field: string, message: string): PhotoFailure => ({
  ok: false,
  status,
  errors: [{ field, message }],
});

// R2 に保存してから行を作る。行の作成に失敗したら R2 を消す(片方だけ残さない)
export async function savePhoto(
  db: D1Database,
  bucket: R2Bucket,
  bytes: ArrayBuffer,
  meta: unknown,
  options: CoreOptions = {},
): Promise<PhotoResult> {
  const parsed = photoMetaSchema.safeParse(meta);
  if (!parsed.success) return { ok: false, status: 400, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;

  if (bytes.byteLength === 0) return fail(400, "file", "file: 空のファイルです。写真を選び直してください");
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return fail(413, "file", "file: 写真が大きすぎます(上限は5MB)。縮小してから送ってください");
  }
  const mime = detectImageType(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16)));
  if (!mime) return fail(400, "file", "file: 画像の形式が分かりません。JPEG / PNG / WebP の写真を送ってください");

  const errors: FieldError[] = [];
  if (m.transaction_id) {
    const row = await db.prepare("SELECT id FROM transactions WHERE id = ?").bind(m.transaction_id).first();
    if (!row) errors.push({ field: "transaction_id", message: `transaction_id: 「${m.transaction_id}」という取引はありません` });
  }
  if (m.event_id) {
    const row = await db.prepare("SELECT id FROM events WHERE id = ?").bind(m.event_id).first();
    if (!row) errors.push({ field: "event_id", message: `event_id: 「${m.event_id}」という出来事はありません` });
  }
  if (errors.length > 0) return { ok: false, status: 400, errors };

  const now = options.now ?? new Date();
  const id = crypto.randomUUID();
  const key = `photos/${now.getUTCFullYear()}/${id}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  const createdAt = now.toISOString();
  try {
    await db
      .prepare(`INSERT INTO attachments (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, key, m.date ?? null, m.transaction_id ?? null, m.event_id ?? null, m.caption ?? null, createdAt)
      .run();
  } catch (e) {
    await bucket.delete(key).catch(() => undefined);
    throw e;
  }
  const photo = toPhotoView({
    id,
    date: m.date ?? null,
    transaction_id: m.transaction_id ?? null,
    event_id: m.event_id ?? null,
    caption: m.caption ?? null,
    created_at: createdAt,
  });
  return { ok: true, photo, message: "写真を保存しました" };
}

const idParam = z.string().min(1).max(100);
const notFound = (id: string) => fail(404, "id", `id: 「${id}」という写真はありません`);

export async function getPhoto(db: D1Database, bucket: R2Bucket, id: string): Promise<GetPhotoResult> {
  if (!idParam.safeParse(id).success) return notFound(id);
  const row = await db.prepare(`SELECT ${COLUMNS} FROM attachments WHERE id = ?`).bind(id).first<PhotoRow>();
  if (!row) return notFound(id);
  const object = await bucket.get(row.r2_key);
  if (!object) return notFound(id);
  // 保存時に検証した値だけを使う。想定外の値は、画像として返さない
  const stored = object.httpMetadata?.contentType ?? "";
  if (!ALLOWED.includes(stored)) return fail(404, "id", `id: 「${id}」の写真は表示できません`);
  return { ok: true, body: object.body, contentType: stored as PhotoMime, size: object.size };
}

// R2 → 行の順に消す。途中で失敗しても、再実行すれば消える向きにする
export async function deletePhoto(db: D1Database, bucket: R2Bucket, id: string): Promise<DeletePhotoResult> {
  if (!idParam.safeParse(id).success) return notFound(id);
  const row = await db.prepare(`SELECT ${COLUMNS} FROM attachments WHERE id = ?`).bind(id).first<PhotoRow>();
  if (!row) return notFound(id);
  await bucket.delete(row.r2_key);
  await db.prepare("DELETE FROM attachments WHERE id = ?").bind(id).run();
  return { ok: true, deleted: toPhotoView(row), message: "写真を削除しました" };
}

// その日に紐づく写真かどうかの条件(col は日付の列。a は attachments)
// 日付そのもの、その日の取引、その日と重なる出来事のいずれか
export const photoOnDay = (col: string) => `(a.date = ${col}
  OR a.transaction_id IN (SELECT id FROM transactions WHERE date = ${col})
  OR a.event_id IN (SELECT id FROM events WHERE start_date <= ${col} AND COALESCE(end_date, start_date) >= ${col}))`;

export async function listPhotosOnDay(db: D1Database, date: string): Promise<PhotoView[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.date, a.transaction_id, a.event_id, a.caption, a.created_at FROM attachments a
       WHERE ${photoOnDay("?")} ORDER BY a.created_at, a.id`,
    )
    .bind(date, date, date, date)
    .all<Omit<PhotoRow, "r2_key">>();
  return results.map(toPhotoView);
}
