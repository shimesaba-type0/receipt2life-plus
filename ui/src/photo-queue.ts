// 写真の複数アップロード・複数削除で使う純関数(同時実行の制限、ファイル検査、結果集計)
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_BATCH = 20;
export const UPLOAD_CONCURRENCY = 2;
export const DELETE_CONCURRENCY = 2;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type Settled<R> = { status: "fulfilled"; value: R } | { status: "rejected"; reason: unknown };

// items を最大 limit 件ずつ並行で処理する。結果は入力順。1件が例外でも残りは続ける
export async function runWithLimit<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  const size = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 1));
  let next = 0;
  async function lane(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i] as T, i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

// 送る前の検査。問題なければ null、あれば日本語の理由
export function validateImageFile(file: FileLike): string | null {
  if (!file.type.startsWith("image/")) return "画像ファイルではありません。";
  if (!ALLOWED_TYPES.includes(file.type)) return "JPEG・PNG・WebP の画像だけ追加できます。";
  if (file.size <= 0) return "ファイルが空です。";
  if (file.size > MAX_UPLOAD_BYTES) return "5MBを超えています。";
  return null;
}

export interface UploadPlan<F extends FileLike> {
  accepted: F[];
  rejected: { name: string; reason: string }[];
}

// 検査で弾き、残りを1回 MAX_FILES_PER_BATCH 枚までにする(超過分は理由つきで弾く)
export function planUploads<F extends FileLike>(files: readonly F[], max: number = MAX_FILES_PER_BATCH): UploadPlan<F> {
  const accepted: F[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const file of files) {
    const reason = validateImageFile(file);
    if (reason) rejected.push({ name: file.name, reason });
    else if (accepted.length >= max) rejected.push({ name: file.name, reason: `1回に追加できるのは${max}枚までです。` });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

export interface ItemResult {
  name: string;
  error: string | null;
}

export interface Summary {
  ok: number;
  failed: number;
  message: string;
  failures: { name: string; reason: string }[];
}

// 「N枚追加、M枚失敗」。verb は「追加」「削除」
export function summarizeResults(verb: string, results: readonly ItemResult[]): Summary {
  const failures = results.filter((r) => r.error !== null).map((r) => ({ name: r.name, reason: r.error as string }));
  const ok = results.length - failures.length;
  const failed = failures.length;
  return { ok, failed, message: failed > 0 ? `${ok}枚${verb}、${failed}枚失敗` : `${ok}枚${verb}`, failures };
}

export type UploadStatus = "waiting" | "resizing" | "uploading" | "done" | "failed";

export function statusLabel(s: UploadStatus): string {
  switch (s) {
    case "waiting":
      return "待機中";
    case "resizing":
      return "縮小中";
    case "uploading":
      return "送信中";
    case "done":
      return "完了";
    case "failed":
      return "失敗";
  }
}
