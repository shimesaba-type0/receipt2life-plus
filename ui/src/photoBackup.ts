import { readZip, ZipBuilder, type ZipEntry } from "./zip";

// 写真のバックアップ(ZIP)の、作り方と戻し方。通信(fetch)は、引数で受ける(テストできるように)
// 作る: 書き出し(JSONL)の attachment の行から写真の一覧を読み、写真を1枚ずつ取り出して、ZIP にまとめる。100MB か 500枚で、別のファイルに分ける
// 戻す: 先にバックアップ(JSONL)を読み込んでおく(写真の情報は、その行から)。ZIP の中の画像を、1枚ずつ、id の写真に戻す

export const PART_MAX_BYTES = 100 * 1024 * 1024;
export const PART_MAX_FILES = 500;
export const PHOTO_LIST_FILE = "photos.json";

export interface PhotoRecord {
  id: string;
  date: string | null;
  caption: string | null;
  transaction_id: string | null;
  event_id: string | null;
  created_at: string | null;
}

/** 書き出し(JSONL)から、写真(attachment)の行を取り出す。壊れた行・id のない行は飛ばす */
export function parsePhotoRecords(jsonl: string): PhotoRecord[] {
  const out: PhotoRecord[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      if (r.type !== "attachment" || typeof r.id !== "string" || r.id === "") continue;
      const str = (v: unknown) => (typeof v === "string" ? v : null);
      out.push({ id: r.id, date: str(r.date), caption: str(r.caption), transaction_id: str(r.transaction_id), event_id: str(r.event_id), created_at: str(r.created_at) });
    } catch {
      // 壊れた行は飛ばす
    }
  }
  return out;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function photoFileName(id: string, contentType: string): string {
  return `${id}.${EXT[contentType.split(";")[0]!.trim().toLowerCase()] ?? "bin"}`;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** ZIP の中のファイル名から、写真の id を取り出す(「<id>.jpg」など)。写真でないファイル(photos.json など)や、不正な名前は null */
export function photoIdFromFileName(name: string): string | null {
  const base = name.split("/").pop() ?? "";
  if (base === PHOTO_LIST_FILE) return null;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  if (!["jpg", "jpeg", "png", "webp", "bin"].includes(ext)) return null;
  const id = base.slice(0, dot);
  return ID_PATTERN.test(id) ? id : null;
}

export type FetchedPhoto = { ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: string };

export interface PhotoZipPart {
  blob: Blob;
  // 1始まりの番号
  index: number;
  files: number;
  bytes: number;
}

export interface BuildSummary {
  total: number;
  saved: number;
  parts: number;
  failed: { id: string; reason: string }[];
}

/** 写真を順に取り出して、ZIP の部品(100MB・500枚まで)にまとめる。できた部品は、そのつど onPart に渡す(メモリに溜めない) */
export async function buildPhotoZips(
  records: readonly PhotoRecord[],
  fetchPhoto: (id: string) => Promise<FetchedPhoto>,
  hooks: { onProgress?: (done: number, total: number) => void; onPart: (part: PhotoZipPart) => void | Promise<void> },
  options: { maxBytes?: number; maxFiles?: number; now?: Date } = {},
): Promise<BuildSummary> {
  const maxBytes = options.maxBytes ?? PART_MAX_BYTES;
  const maxFiles = options.maxFiles ?? PART_MAX_FILES;
  const summary: BuildSummary = { total: records.length, saved: 0, parts: 0, failed: [] };
  let zip = new ZipBuilder(options.now);
  let listed: Record<string, unknown>[] = [];
  const flush = async () => {
    if (zip.fileCount === 0) return;
    zip.add(PHOTO_LIST_FILE, new TextEncoder().encode(JSON.stringify(listed, null, 2) + "\n"));
    summary.parts++;
    await hooks.onPart({ blob: zip.finish(), index: summary.parts, files: listed.length, bytes: zip.byteSize });
    zip = new ZipBuilder(options.now);
    listed = [];
  };
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    hooks.onProgress?.(i, records.length);
    const got = await fetchPhoto(rec.id);
    if (!got.ok) {
      summary.failed.push({ id: rec.id, reason: got.reason });
      continue;
    }
    if (zip.fileCount > 0 && (zip.fileCount >= maxFiles || zip.byteSize + got.bytes.length > maxBytes)) await flush();
    const file = photoFileName(rec.id, got.contentType);
    zip.add(file, got.bytes);
    listed.push({ file, ...rec });
    summary.saved++;
  }
  await flush();
  hooks.onProgress?.(records.length, records.length);
  return summary;
}

export type PutResult = { ok: true; status: "restored" | "exists" } | { ok: false; status: number; error: string };

export interface RestoreSummary {
  total: number;
  restored: number;
  exists: number;
  // 写真の情報(JSONL の行)が、まだ無い(先に JSONL を読み込む必要がある)
  noRecord: number;
  failed: { name: string; reason: string }[];
  // 途中で止まったときの理由(通信の失敗など)
  stoppedBy: string | null;
}

const RETRY_WAITS_MS = [5000, 15000, 30000];

/** ZIP の中の写真を、1枚ずつ戻す。429(回数の制限)は、待って送り直す。通信が続けて失敗したら、そこで止める */
export async function restorePhotos(
  entries: readonly ZipEntry[],
  put: (id: string, bytes: Uint8Array) => Promise<PutResult>,
  hooks: { onProgress?: (done: number, total: number) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RestoreSummary> {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const photos = entries.map((e) => ({ e, id: photoIdFromFileName(e.name) })).filter((x): x is { e: ZipEntry; id: string } => x.id !== null);
  const s: RestoreSummary = { total: photos.length, restored: 0, exists: 0, noRecord: 0, failed: [], stoppedBy: null };
  for (let i = 0; i < photos.length; i++) {
    const { e, id } = photos[i]!;
    hooks.onProgress?.(i, photos.length);
    let bytes: Uint8Array;
    try {
      bytes = await e.read();
    } catch (err) {
      s.failed.push({ name: e.name, reason: err instanceof Error ? err.message : "読めませんでした" });
      continue;
    }
    let res = await put(id, bytes);
    for (let attempt = 0; !res.ok && res.status === 429 && attempt < RETRY_WAITS_MS.length; attempt++) {
      await sleep(RETRY_WAITS_MS[attempt]!);
      res = await put(id, bytes);
    }
    if (res.ok) {
      if (res.status === "restored") s.restored++;
      else s.exists++;
    } else if (res.status === 404) {
      s.noRecord++;
    } else if (res.status === 400 || res.status === 413) {
      s.failed.push({ name: e.name, reason: res.error });
    } else {
      s.stoppedBy = res.error || `通信に失敗しました(${res.status})`;
      break;
    }
  }
  if (!s.stoppedBy) hooks.onProgress?.(photos.length, photos.length);
  return s;
}

/** ZIP(Blob)を何個か読んで、中のファイルをまとめる。読めない ZIP は、理由つきで返す */
export async function readZips(files: readonly Blob[], names: readonly string[]): Promise<{ entries: ZipEntry[]; errors: string[] }> {
  const entries: ZipEntry[] = [];
  const errors: string[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      entries.push(...(await readZip(files[i]!)));
    } catch (err) {
      errors.push(`${names[i] ?? "ファイル"}: ${err instanceof Error ? err.message : "読めませんでした"}`);
    }
  }
  return { entries, errors };
}
