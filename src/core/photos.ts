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
    await bucket.delete(key).catch((err: unknown) => {
      // 値・キー・IDは出さない。失敗の種類だけ
      console.error("photo: R2 cleanup failed", err instanceof Error ? err.name : typeof err);
    });
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

const idParam = z.string().min(1).max(64);
const notFound = (id: string) => fail(404, "id", `id: 「${id.slice(0, 64)}」という写真はありません`);

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

// ---- MCP 向け: アップロード用リンク・一覧・取得 ----
// 画像の実体はMCPのツール呼び出しでは登録できない。登録は、リンクを利用者が開いて画面(Cloudflare Access の内側)から行う

const idField = z.string().min(1).max(100);

// MCP の入力定義(.shape)に使う。「どれか1つ以上」の検証は各関数で行う
export const photoLinkFieldsSchema = z.strictObject({
  date: isoDate.optional().describe("写真を紐づける日付(YYYY-MM-DD)"),
  transaction_id: idField.optional().describe("写真を紐づける取引の id(list_transactions や add_transactions の結果で分かる)"),
  event_id: idField.optional().describe("写真を紐づける出来事の id(list_events で分かる)"),
  caption: z.string().trim().min(1).max(200).optional().describe("写真の説明(200文字まで、任意)"),
});

const anyTarget = (m: { date?: string; transaction_id?: string; event_id?: string }) =>
  Boolean(m.date || m.transaction_id || m.event_id);
const TARGET_MESSAGE = "date、transaction_id、event_id のうち1つ以上を指定してください";

export const createPhotoUploadLinkSchema = photoLinkFieldsSchema.refine(anyTarget, { message: TARGET_MESSAGE, path: ["date"] });

export const listPhotosFieldsSchema = photoLinkFieldsSchema.omit({ caption: true });
export const listPhotosSchema = listPhotosFieldsSchema.refine(anyTarget, { message: TARGET_MESSAGE, path: ["date"] });

export const MAX_GET_PHOTOS = 4;
// 1回の get_photos で返す画像の合計(元のバイト数)。超える分は返さない
export const MAX_GET_PHOTOS_BYTES = 6 * 1024 * 1024;

export const getPhotosFieldsSchema = z.strictObject({
  ids: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MAX_GET_PHOTOS)
    .describe(`写真の id の配列(1〜${MAX_GET_PHOTOS}個)。list_photos で分かる`),
});

export interface PhotoMeta {
  id: string;
  date: string | null;
  transaction_id: string | null;
  event_id: string | null;
  caption: string | null;
  content_type: string | null;
  size: number | null;
  created_at: string;
}

export type PhotoLinkResult = { ok: true; url: string; message: string } | { ok: false; errors: FieldError[] };
export type ListPhotosResult = { ok: true; count: number; photos: PhotoMeta[]; message: string } | { ok: false; errors: FieldError[] };
export interface PhotoImage {
  data: string; // base64
  mimeType: PhotoMime;
}
export type GetPhotosResult =
  | { ok: false; errors: FieldError[] }
  | {
      ok: boolean; // 存在しない id が1つでもあれば false(取れた分は photos / images に入る)
      photos: PhotoMeta[];
      images: PhotoImage[]; // photos と同じ順
      errors: FieldError[];
      skipped: { id: string; reason: string }[];
      message: string;
    };

// 参照先(取引・出来事)が存在するかを確かめて、無いものをエラーにする
async function checkRefs(db: D1Database, m: { transaction_id?: string; event_id?: string }): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  if (m.transaction_id) {
    const row = await db.prepare("SELECT id FROM transactions WHERE id = ?").bind(m.transaction_id).first();
    if (!row) errors.push({ field: "transaction_id", message: `transaction_id: 「${m.transaction_id}」という取引はありません` });
  }
  if (m.event_id) {
    const row = await db.prepare("SELECT id FROM events WHERE id = ?").bind(m.event_id).first();
    if (!row) errors.push({ field: "event_id", message: `event_id: 「${m.event_id}」という出来事はありません` });
  }
  return errors;
}

// origin はリクエストのURLから取ったもの(ドメインを固定で持たない)。期限やトークンは付けない
export async function createPhotoUploadLink(db: D1Database, origin: string, input: unknown): Promise<PhotoLinkResult> {
  const parsed = createPhotoUploadLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const errors = await checkRefs(db, m);
  if (errors.length > 0) return { ok: false, errors };

  const params = new URLSearchParams();
  for (const key of ["date", "transaction_id", "event_id", "caption"] as const) {
    const value = m[key];
    if (value) params.set(key, value);
  }
  const url = `${origin}/photos/add?${params.toString()}`;
  return { ok: true, url, message: `このリンクを開いて写真を選んでください: ${url}` };
}

async function toMeta(bucket: R2Bucket, row: PhotoRow): Promise<PhotoMeta> {
  const head = await bucket.head(row.r2_key);
  return {
    id: row.id,
    date: row.date,
    transaction_id: row.transaction_id,
    event_id: row.event_id,
    caption: row.caption,
    content_type: head?.httpMetadata?.contentType ?? null,
    size: head?.size ?? null,
    created_at: row.created_at,
  };
}

// 複数指定は和集合。date は日の詳細と同じ条件(photoOnDay)
export async function listPhotos(db: D1Database, bucket: R2Bucket, input: unknown): Promise<ListPhotosResult> {
  const parsed = listPhotosSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const errors = await checkRefs(db, m);
  if (errors.length > 0) return { ok: false, errors };

  const conditions: string[] = [];
  const binds: string[] = [];
  if (m.date) {
    conditions.push(photoOnDay("?"));
    binds.push(m.date, m.date, m.date, m.date);
  }
  if (m.transaction_id) {
    conditions.push("a.transaction_id = ?");
    binds.push(m.transaction_id);
  }
  if (m.event_id) {
    conditions.push("a.event_id = ?");
    binds.push(m.event_id);
  }
  const { results } = await db
    .prepare(
      `SELECT a.id, a.r2_key, a.date, a.transaction_id, a.event_id, a.caption, a.created_at FROM attachments a
       WHERE ${conditions.join(" OR ")} ORDER BY a.created_at, a.id`,
    )
    .bind(...binds)
    .all<PhotoRow>();
  const photos = await Promise.all(results.map((row) => toMeta(bucket, row)));
  const message = photos.length === 0 ? "該当する写真はありません" : `${photos.length}枚の写真があります`;
  return { ok: true, count: photos.length, photos, message };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

// 画像を base64 で返す。保存時に検証した Content-Type(JPEG/PNG/WebP)だけを使う。
// 合計が MAX_GET_PHOTOS_BYTES を超える分は返さず、skipped に理由を入れる
export async function getPhotos(db: D1Database, bucket: R2Bucket, input: unknown): Promise<GetPhotosResult> {
  const parsed = getPhotosFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const ids = [...new Set(parsed.data.ids)];

  const photos: PhotoMeta[] = [];
  const images: PhotoImage[] = [];
  const errors: FieldError[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let total = 0;
  for (const id of ids) {
    const row = await db.prepare(`SELECT ${COLUMNS} FROM attachments WHERE id = ?`).bind(id).first<PhotoRow>();
    const head = row ? await bucket.head(row.r2_key) : null;
    if (!row || !head) {
      errors.push({ field: "ids", message: `ids: 「${id}」という写真はありません` });
      continue;
    }
    const stored = head.httpMetadata?.contentType ?? "";
    if (!ALLOWED.includes(stored)) {
      errors.push({ field: "ids", message: `ids: 「${id}」の写真は表示できません(JPEG / PNG / WebP ではありません)` });
      continue;
    }
    if (total + head.size > MAX_GET_PHOTOS_BYTES) {
      skipped.push({
        id,
        reason: `1回に返せる画像の合計が約${MAX_GET_PHOTOS_BYTES / 1024 / 1024}MBを超えるため返していません(この写真は${mb(head.size)}MB)。この id だけで get_photos を呼び直してください`,
      });
      continue;
    }
    const object = await bucket.get(row.r2_key);
    if (!object) {
      errors.push({ field: "ids", message: `ids: 「${id}」という写真はありません` });
      continue;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    total += bytes.byteLength;
    photos.push({
      id: row.id,
      date: row.date,
      transaction_id: row.transaction_id,
      event_id: row.event_id,
      caption: row.caption,
      content_type: stored,
      size: bytes.byteLength,
      created_at: row.created_at,
    });
    images.push({ data: toBase64(bytes), mimeType: stored as PhotoMime });
  }

  const parts = [`${photos.length}枚の写真を返しました`];
  if (skipped.length > 0) parts.push(`${skipped.length}枚は合計サイズの上限のため返していません`);
  if (errors.length > 0) parts.push(`${errors.length}件のエラーがあります`);
  return { ok: errors.length === 0, photos, images, errors, skipped, message: parts.join("。") };
}
