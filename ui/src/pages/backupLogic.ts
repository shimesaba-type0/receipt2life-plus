// エクスポート/インポート画面の純粋な部分(DOMに触れない。テストする)
// サーバー(src/io/jsonl.ts)の1回の上限(5MB・5,000行)。画面は、大きなファイルを自動で小分けして、この上限の内側で何回かに分けて送る
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_LINES = 5000;
// 画面で選べるファイルの上限(小分けして送るので、サーバーの1回の上限より大きくできる。ブラウザの負担を抑えるための上限)
export const IMPORT_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const IMPORT_FILE_MAX_LINES = 100_000;
// 1回に送る量の目安(サーバーの上限よりずっと小さくする。Worker の処理時間と、D1 の書き込みの負担を抑えるため)
export const CHUNK_MAX_LINES = 400;
export const CHUNK_MAX_BYTES = 1024 * 1024;
// エラー行を画面に出す最大件数
export const MAX_ERROR_LINES = 50;

// POST /import の応答(サーバーの ImportResult と同じ形。src は UI から読まないので、ここに写す)
export type ImportStatus = "ok" | "skipped_duplicate" | "skipped_exists" | "error";
export interface ImportRow {
  line: number;
  type: string | null;
  status: ImportStatus;
  id?: string;
  message?: string;
}
export type ImportResponse =
  | { ok: true; summary: { total: number; ok: number; skipped: number; errors: number }; results: ImportRow[] }
  | { ok: false; error: string };

export type Check = { ok: true } | { ok: false; error: string };

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const fmt = (n: number) => n.toLocaleString("en-US");

// ファイルを読む前の検査(サイズと空)
export function validateImportFile(size: number): Check {
  if (size === 0) return { ok: false, error: "ファイルが空です。書き出したバックアップ(JSONL)を選んでください。" };
  if (size > IMPORT_FILE_MAX_BYTES) {
    return { ok: false, error: `ファイルが大きすぎます(${formatFileSize(size)})。上限は50MBです。ファイルを分けてください。` };
  }
  return { ok: true };
}

// 読んだ中身の検査(行数。空行は数えない。JSON配列は件数)。壊れた中身の判定はサーバーに任せる
export function validateImportText(text: string): { ok: true; count: number } | { ok: false; error: string } {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === "") return { ok: false, error: "ファイルが空です。書き出したバックアップ(JSONL)を選んでください。" };
  let count: number;
  if (body.trimStart().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(body);
      count = Array.isArray(parsed) ? parsed.length : 1;
    } catch {
      return { ok: true, count: 1 };
    }
  } else {
    count = body.split("\n").filter((l) => l.trim() !== "").length;
  }
  if (count > IMPORT_FILE_MAX_LINES) {
    return { ok: false, error: `行数が多すぎます(${fmt(count)}行)。上限は${fmt(IMPORT_FILE_MAX_LINES)}行です。ファイルを分けてください。` };
  }
  return { ok: true, count };
}

export interface ImportCounts {
  registered: number;
  duplicate: number;
  exists: number;
  errors: number;
  total: number;
}

export function summarizeImport(rows: ImportRow[]): ImportCounts {
  const c: ImportCounts = { registered: 0, duplicate: 0, exists: 0, errors: 0, total: rows.length };
  for (const r of rows) {
    if (r.status === "ok") c.registered++;
    else if (r.status === "skipped_duplicate") c.duplicate++;
    else if (r.status === "skipped_exists") c.exists++;
    else c.errors++;
  }
  return c;
}

export function formatErrorLine(row: ImportRow): string {
  return `${row.line}行目: ${row.message ?? "読み込めませんでした"}`;
}

export function errorLines(rows: ImportRow[]): { items: string[]; more: number } {
  const errs = rows.filter((r) => r.status === "error");
  return { items: errs.slice(0, MAX_ERROR_LINES).map(formatErrorLine), more: Math.max(0, errs.length - MAX_ERROR_LINES) };
}

// 全体のエラー(413 など)の文。サーバーの文があればそれを優先する
export function importHttpError(status: number, serverMessage?: string): string {
  if (serverMessage) return serverMessage;
  if (status === 413) return "ファイルが大きすぎます。5MB・5,000行以下に分けてください。";
  if (status === 400) return "ファイルの中身を読み込めません。書き出したJSONLを選んでください。";
  if (status === 403) return "この画面と同じサイトからのみ読み込めます。ページを開き直してからやり直してください。";
  return `読み込みに失敗しました(${status})。時間をおいてやり直してください。`;
}

// ---- 読み物のエクスポート(Markdown / HTML) ----
// サーバー(src/core/period-report.ts)と同じ規則。期間は月・年・日付の範囲のどれか1つ
export type ReportMode = "month" | "year" | "range";
export type ReportFormat = "markdown" | "html";
export interface ReportInput {
  month: string;
  year: string;
  from: string;
  to: string;
}
// 期間の上限(日数。サーバーと同じ)
export const REPORT_MAX_DAYS = 366;

const inclusiveDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

// 入力が正しければクエリ文字列(例: month=2026-10)、足りない・正しくなければ理由
export function reportQuery(mode: ReportMode, v: ReportInput): { ok: true; query: string } | { ok: false; error: string } {
  if (mode === "month") {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(v.month) ? { ok: true, query: `month=${v.month}` } : { ok: false, error: "月を選んでください。" };
  }
  if (mode === "year") {
    return /^\d{4}$/.test(v.year) ? { ok: true, query: `year=${v.year}` } : { ok: false, error: "年を4桁で入れてください(例: 2026)。" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.from) || !/^\d{4}-\d{2}-\d{2}$/.test(v.to)) return { ok: false, error: "はじまりの日と終わりの日を選んでください。" };
  if (v.from > v.to) return { ok: false, error: "終わりの日は、はじまりの日以降にしてください。" };
  if (inclusiveDays(v.from, v.to) > REPORT_MAX_DAYS) return { ok: false, error: `期間は${REPORT_MAX_DAYS}日までです。分けて書き出してください。` };
  return { ok: true, query: `from=${v.from}&to=${v.to}` };
}

export const reportHref = (format: ReportFormat, query: string) => `/export/${format}?${query}`;

// ---- 大きなファイルを小分けして読み込む ----
// サーバーは1回に5MB・5,000行までなので、画面は、ファイルを小さな塊に分けて、順に送る。
// 取引と、その明細(item の行)は、必ず同じ塊に入れる(明細は、同じ塊の取引といっしょに書くため)。それ以外の行は、ファイルの順のまま。
// 読み込みは、同じ id の行を飛ばす(何度戻しても増えない)ので、途中で止まっても、やり直せば続きから戻せる

export interface ImportChunk {
  // サーバーに送る本文(JSONL)
  text: string;
  // 塊の中の n 行目(1始まり)が、元のファイルの何行目か(エラーの行番号を、元のファイルの行に直すため)
  origLines: number[];
}

interface Entry {
  text: string;
  line: number;
}

// ファイルの中身を、行(空行を除く)に分ける。JSON配列は、1要素を1行にする
function toEntries(text: string): Entry[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trimStart().startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (Array.isArray(parsed)) return parsed.map((v, i) => ({ text: JSON.stringify(v), line: i + 1 }));
    } catch {
      // 配列として読めなければ、サーバーにそのまま判定させる(1行として送る)
      return [{ text: body, line: 1 }];
    }
  }
  const out: Entry[] = [];
  body.split("\n").forEach((l, i) => {
    if (l.trim() !== "") out.push({ text: l.trimEnd(), line: i + 1 });
  });
  return out;
}

interface Meta {
  type: string | null;
  id: string | null;
  transaction_id: string | null;
}

function metaOf(text: string): Meta {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === "string" ? x : null);
    return { type: str(v.type), id: str(v.id), transaction_id: str(v.transaction_id) };
  } catch {
    return { type: null, id: null, transaction_id: null };
  }
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** ファイルの中身を、サーバーの上限の内側の塊に分ける(取引と明細は同じ塊。順序は元のまま) */
export function planImportChunks(text: string, maxLines = CHUNK_MAX_LINES, maxBytes = CHUNK_MAX_BYTES): ImportChunk[] {
  const entries = toEntries(text);
  const metas = entries.map((e) => metaOf(e.text));
  const txIds = new Set<string>();
  for (const m of metas) if (m.type === "transaction" && m.id) txIds.add(m.id);
  // 取引ごとの明細の位置
  const itemsOf = new Map<string, number[]>();
  metas.forEach((m, i) => {
    if (m.type === "item" && m.transaction_id && txIds.has(m.transaction_id)) itemsOf.set(m.transaction_id, [...(itemsOf.get(m.transaction_id) ?? []), i]);
  });

  // 分けられない単位(取引+明細)にまとめる。ファイルでの最初の位置の順
  const bundles: number[][] = [];
  metas.forEach((m, i) => {
    if (m.type === "item" && m.transaction_id && txIds.has(m.transaction_id)) return;
    bundles.push(m.type === "transaction" && m.id ? [i, ...(itemsOf.get(m.id) ?? [])] : [i]);
  });

  const chunks: ImportChunk[] = [];
  let cur: number[] = [];
  let curBytes = 0;
  const flush = () => {
    if (cur.length === 0) return;
    chunks.push({ text: cur.map((i) => entries[i]!.text).join("\n") + "\n", origLines: cur.map((i) => entries[i]!.line) });
    cur = [];
    curBytes = 0;
  };
  for (const b of bundles) {
    const bytes = b.reduce((s, i) => s + byteLength(entries[i]!.text) + 1, 0);
    if (cur.length > 0 && (cur.length + b.length > maxLines || curBytes + bytes > maxBytes)) flush();
    cur.push(...b);
    curBytes += bytes;
  }
  flush();
  return chunks;
}

export interface ChunkSender {
  (body: string): Promise<ImportResponse & { status: number }>;
}

export type ChunkedOutcome =
  | { kind: "done"; rows: ImportRow[] }
  // 途中で止まった: 読み込めた分の結果、止まった塊の番号(1始まり)と、全体の塊の数、理由
  | { kind: "stopped"; rows: ImportRow[]; failedAt: number; total: number; message: string };

const RETRY_WAITS_MS = [5000, 15000, 30000];

/** 塊を順に送り、結果を1つにまとめる。行番号は元のファイルの行に直す。429(回数の制限)は、待って送り直す */
export async function importInChunks(
  chunks: ImportChunk[],
  send: ChunkSender,
  options: { onProgress?: (done: number, total: number) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ChunkedOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rows: ImportRow[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    options.onProgress?.(i, chunks.length);
    let res = await send(chunk.text);
    for (let attempt = 0; !res.ok && res.status === 429 && attempt < RETRY_WAITS_MS.length; attempt++) {
      await sleep(RETRY_WAITS_MS[attempt]!);
      res = await send(chunk.text);
    }
    if (!res.ok) return { kind: "stopped", rows, failedAt: i + 1, total: chunks.length, message: importHttpError(res.status, res.error) };
    for (const r of res.results) rows.push({ ...r, line: chunk.origLines[r.line - 1] ?? r.line });
  }
  options.onProgress?.(chunks.length, chunks.length);
  return { kind: "done", rows };
}

// バックアップの状況の文言(最後に書き出した日と、お知らせ)
export function backupStatusText(lastAt: string | null, daysSince: number | null): string {
  if (lastAt === null || daysSince === null) return "まだバックアップを書き出していません。";
  const day = lastAt.slice(0, 10).replaceAll("-", "/");
  return daysSince === 0 ? `最後のバックアップ: ${day}(今日)` : `最後のバックアップ: ${day}(${daysSince}日前)`;
}

export function backupRemindText(daysSince: number | null): string {
  return daysSince === null ? "まだバックアップを取っていません。バックアップを書き出しましょう。" : `最後のバックアップから${daysSince}日たちました。バックアップを書き出しましょう。`;
}
