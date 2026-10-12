// エクスポート/インポート画面の純粋な部分(DOMに触れない。テストする)
// 上限はサーバー(src/io/jsonl.ts)と同じ。送る前に検査して、理由を日本語で出す
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_LINES = 5000;
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
  if (size > IMPORT_MAX_BYTES) {
    return { ok: false, error: `ファイルが大きすぎます(${formatFileSize(size)})。上限は5MBです。ファイルを分けてください。` };
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
  if (count > IMPORT_MAX_LINES) {
    return { ok: false, error: `行数が多すぎます(${fmt(count)}行)。上限は${fmt(IMPORT_MAX_LINES)}行です。ファイルを分けてください。` };
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
