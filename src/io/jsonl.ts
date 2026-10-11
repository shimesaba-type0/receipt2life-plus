import { z } from "zod";
import { todayJst } from "../core/dates";
import {
  eventInputSchema,
  isoDate,
  toFieldErrors,
  transactionInputSchema,
  type EventInput,
  type FieldError,
  type TransactionInput,
} from "../core/schema";
import { parseLinkUrl, MAX_URL_LENGTH } from "../core/links";
import { dedupHash } from "../core/transactions";

// ---- 上限 ----
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_LINES = 5000;
// エクスポートで一度に読む行数
const EXPORT_PAGE = 500;
// D1: 1文あたりのバインド変数は100個まで。IN句は余裕をみて90個ずつ
const IN_CHUNK = 90;
// batch に入れる文の数(上限を超えないよう分割する)
const BATCH_SIZE = 50;

// ---- エクスポート ----

interface TableSpec {
  sql: string;
}

// id の昇順で、前のページの最後の id より後ろを読む(OFFSET を使わず、行数が増えても遅くならない)
const EXPORT_TABLES: TableSpec[] = [
  {
    sql: `SELECT 'event' AS type, id, start_date, end_date, title, note, color, created_at, updated_at
          FROM events WHERE id > ? ORDER BY id LIMIT ?`,
  },
  {
    sql: `SELECT 'transaction' AS type, t.id, t.date, t.amount, t.merchant, c.name AS category, a.name AS account,
                 t.memo, t.source, t.status, t.created_at, t.updated_at
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.id > ? ORDER BY t.id LIMIT ?`,
  },
  {
    sql: `SELECT 'attachment' AS type, id, r2_key, date, transaction_id, event_id, caption, created_at
          FROM attachments WHERE id > ? ORDER BY id LIMIT ?`,
  },
  {
    sql: `SELECT 'link' AS type, id, url, kind, title, date, transaction_id, event_id, created_at
          FROM links WHERE id > ? ORDER BY id LIMIT ?`,
  },
];

async function* exportChunks(db: D1Database): AsyncGenerator<string> {
  for (const table of EXPORT_TABLES) {
    let after = "";
    for (;;) {
      const { results } = await db.prepare(table.sql).bind(after, EXPORT_PAGE).all<{ id: string }>();
      if (results.length === 0) break;
      yield results.map((r) => `${JSON.stringify(r)}\n`).join("");
      if (results.length < EXPORT_PAGE) break;
      after = results[results.length - 1]!.id;
    }
  }
}

/**
 * 全データをJSONL(1行1レコード)で返す。event → transaction → attachment → link の順(外部キーの順)。
 * 500行ずつ読み出して流すので、行数が多くてもメモリを使いすぎない。
 */
export function exportJsonl(db: D1Database): ReadableStream<Uint8Array> {
  const chunks = exportChunks(db);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

// ---- インポート ----

export type ImportStatus = "ok" | "skipped_duplicate" | "skipped_exists" | "error";

export interface ImportResult {
  line: number;
  type: string | null;
  status: ImportStatus;
  id?: string;
  message?: string;
}

export interface ImportSummary {
  total: number;
  ok: number;
  skipped: number;
  errors: number;
}

export type ImportResponse =
  | { ok: true; summary: ImportSummary; results: ImportResult[] }
  | { ok: false; status: 400 | 413; error: string };

export interface ImportOptions {
  now?: Date;
}

const RECORD_TYPES = ["event", "transaction", "attachment", "link"] as const;
type RecordType = (typeof RECORD_TYPES)[number];

interface Entry {
  index: number;
  line: number;
  type: string | null;
  // 型の判定まで済んだオブジェクト(type は取り除き済み、null の項目は省略扱い)
  record?: Record<string, unknown>;
  parseError?: string;
}

const idField = z.string().min(1, "空にできません").max(100, "100文字以内にしてください");
const timestampField = z.iso.datetime({ error: "UTCの日時(例: 2026-10-11T03:00:00.000Z)で指定してください" });
const commonExtras = { id: idField.optional(), created_at: timestampField.optional(), updated_at: timestampField.optional() };
const eventExtrasSchema = z.strictObject(commonExtras);
const transactionExtrasSchema = z.strictObject({ ...commonExtras, status: z.enum(["ok", "needs_review"]).optional() });

const attachmentSchema = z
  .strictObject({
    id: idField.optional(),
    r2_key: z.string().min(1, "空にできません").max(500),
    date: isoDate.optional(),
    transaction_id: z.string().min(1).optional(),
    event_id: z.string().min(1).optional(),
    caption: z.string().max(500).optional(),
    created_at: timestampField.optional(),
  })
  .refine((a) => a.date || a.transaction_id || a.event_id, {
    message: "date / transaction_id / event_id のうち1つ以上を指定してください",
    path: ["transaction_id"],
  });

// url は core と同じ検証で正規化して保存する。kind はエクスポートが出す項目で、あれば URL から決まる値と一致が必要
const linkSchema = z
  .strictObject({
    id: idField.optional(),
    url: z.string().max(MAX_URL_LENGTH, `${MAX_URL_LENGTH}文字までにしてください`),
    kind: z.enum(["x", "youtube"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    date: isoDate.optional(),
    transaction_id: z.string().min(1).optional(),
    event_id: z.string().min(1).optional(),
    created_at: timestampField.optional(),
  })
  .refine((l) => l.date || l.transaction_id || l.event_id, {
    message: "date / transaction_id / event_id のうち1つ以上を指定してください",
    path: ["transaction_id"],
  });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function tooLarge(error: string): ImportResponse {
  return { ok: false, status: 413, error };
}

function parseEntries(text: string): { entries: Entry[] } | { error: ImportResponse } {
  const body = text.replace(/^\uFEFF/, "");
  if (body.trim() === "") {
    return { error: { ok: false, status: 400, error: "本文が空です。JSONL(1行に1レコード)またはJSON配列を送ってください" } };
  }
  const raws: { line: number; value: unknown; parseError?: string }[] = [];
  if (body.trimStart().startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { error: { ok: false, status: 400, error: `JSON配列として読めません(${reason})。JSONLにする場合は、先頭を [ にせず1行に1レコードで送ってください` } };
    }
    const arr = parsed as unknown[];
    if (arr.length === 0) return { error: { ok: false, status: 400, error: "JSON配列が空です。レコードを1件以上入れてください" } };
    if (arr.length > MAX_IMPORT_LINES) return { error: tooLarge(`レコードが多すぎます(${arr.length}件)。${MAX_IMPORT_LINES}件以下に分けて送ってください`) };
    arr.forEach((value, i) => raws.push({ line: i + 1, value }));
  } else {
    const lines = body.split("\n");
    lines.forEach((text, i) => {
      if (text.trim() === "") return;
      try {
        raws.push({ line: i + 1, value: JSON.parse(text) });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        raws.push({ line: i + 1, value: undefined, parseError: `JSONとして読めません(${reason})。1行に1つのJSONオブジェクトにしてください` });
      }
    });
    if (raws.length > MAX_IMPORT_LINES) return { error: tooLarge(`行数が多すぎます(${raws.length}行)。${MAX_IMPORT_LINES}行以下に分けて送ってください`) };
  }

  const entries: Entry[] = raws.map((raw, index) => {
    const base = { index, line: raw.line };
    if (raw.parseError) return { ...base, type: null, parseError: raw.parseError };
    return { ...base, type: null, record: isObject(raw.value) ? raw.value : undefined };
  });
  return { entries };
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function existingIds(db: D1Database, table: "events" | "transactions" | "attachments" | "links", ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks([...new Set(ids)], IN_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT id FROM ${table} WHERE id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<{ id: string }>();
    for (const r of results) found.add(r.id);
  }
  return found;
}

const joinMessages = (errors: FieldError[]) => errors.map((e) => e.message).join(" / ");

// 取り除いた項目(id など)と残りの項目を、それぞれ検証用に分ける
function splitExtras(record: Record<string, unknown>, keys: string[]) {
  const extras: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) (keys.includes(k) ? extras : rest)[k] = v;
  return { extras, rest };
}

interface Pending {
  entry: Entry;
  id: string;
  statement: D1PreparedStatement;
}

type Report = (entry: Entry, result: Omit<ImportResult, "line" | "type">) => void;

// D1の batch で、上限を超えないよう分割して書き込む。batch が失敗したら1文ずつ試して、失敗した行だけをエラーにする
async function insertAll(db: D1Database, pending: Pending[], report: Report): Promise<void> {
  for (const part of chunks(pending, BATCH_SIZE)) {
    try {
      await db.batch(part.map((p) => p.statement));
      for (const p of part) report(p.entry, { status: "ok", id: p.id });
    } catch {
      for (const p of part) {
        try {
          await p.statement.run();
          report(p.entry, { status: "ok", id: p.id });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          report(p.entry, { status: "error", message: `書き込みに失敗しました(${reason})` });
        }
      }
    }
  }
}

async function importEvents(db: D1Database, entries: Entry[], report: Report, nowIso: string): Promise<void> {
  const valid: { entry: Entry; id: string; data: EventInput; createdAt: string; updatedAt: string; given: boolean }[] = [];
  for (const entry of entries) {
    const { extras, rest } = splitExtras(entry.record!, ["id", "created_at", "updated_at"]);
    const e = eventExtrasSchema.safeParse(extras);
    const d = eventInputSchema.safeParse(rest);
    if (!e.success || !d.success) {
      const errors = [...(e.success ? [] : toFieldErrors(e.error)), ...(d.success ? [] : toFieldErrors(d.error))];
      report(entry, { status: "error", message: joinMessages(errors) });
      continue;
    }
    const createdAt = e.data.created_at ?? nowIso;
    valid.push({ entry, id: e.data.id ?? crypto.randomUUID(), data: d.data, createdAt, updatedAt: e.data.updated_at ?? createdAt, given: e.data.id !== undefined });
  }

  const existing = await existingIds(db, "events", valid.filter((v) => v.given).map((v) => v.id));
  const seen = new Set<string>();
  const pending: Pending[] = [];
  for (const v of valid) {
    if (existing.has(v.id) || seen.has(v.id)) {
      report(v.entry, { status: "skipped_exists", id: v.id, message: `id「${v.id}」の出来事は既にあるためスキップしました` });
      continue;
    }
    seen.add(v.id);
    pending.push({
      entry: v.entry,
      id: v.id,
      statement: db
        .prepare("INSERT INTO events (id, start_date, end_date, title, note, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(v.id, v.data.start_date, v.data.end_date ?? null, v.data.title, v.data.note ?? null, v.data.color, v.createdAt, v.updatedAt),
    });
  }
  await insertAll(db, pending, report);
}

async function loadNames(db: D1Database, table: "categories" | "accounts"): Promise<Map<string, string>> {
  const { results } = await db.prepare(`SELECT id, name FROM ${table} ORDER BY rowid`).all<{ id: string; name: string }>();
  return new Map(results.map((r) => [r.name, r.id]));
}

const unknownName = (field: string, label: string, value: string, names: Map<string, string>) =>
  `${field}: 「${value}」という${label}はありません(自動作成しません)。選べる値: ${[...names.keys()].join("、")}`;

async function importTransactions(db: D1Database, entries: Entry[], report: Report, now: Date): Promise<void> {
  if (entries.length === 0) return;
  const nowIso = now.toISOString();
  const today = todayJst(now);
  const [categories, accounts] = await Promise.all([loadNames(db, "categories"), loadNames(db, "accounts")]);

  const valid: {
    entry: Entry;
    id: string;
    given: boolean;
    isBackup: boolean;
    item: TransactionInput;
    date: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    hash: string;
  }[] = [];
  for (const entry of entries) {
    const { extras, rest } = splitExtras(entry.record!, ["id", "status", "created_at", "updated_at"]);
    const e = transactionExtrasSchema.safeParse(extras);
    const d = transactionInputSchema.safeParse(rest);
    if (!e.success || !d.success) {
      const errors = [...(e.success ? [] : toFieldErrors(e.error)), ...(d.success ? [] : toFieldErrors(d.error))];
      report(entry, { status: "error", message: joinMessages(errors) });
      continue;
    }
    const item = d.data;
    const errors: string[] = [];
    if (item.date && item.date > today) errors.push(`date: 未来の日付(${item.date})は取り込めません。今日は ${today} です`);
    if (item.category && !categories.has(item.category)) errors.push(unknownName("category", "カテゴリ", item.category, categories));
    if (item.account && !accounts.has(item.account)) errors.push(unknownName("account", "口座", item.account, accounts));
    if (errors.length > 0) {
      report(entry, { status: "error", message: errors.join(" / ") });
      continue;
    }
    const date = item.date ?? today;
    const createdAt = e.data.created_at ?? nowIso;
    valid.push({
      entry,
      id: e.data.id ?? crypto.randomUUID(),
      given: e.data.id !== undefined,
      // id と created_at の両方があるのは、エクスポート由来のバックアップ行
      isBackup: e.data.id !== undefined && e.data.created_at !== undefined,
      item,
      date,
      status: e.data.status ?? (!item.merchant || !item.category ? "needs_review" : "ok"),
      createdAt,
      updatedAt: e.data.updated_at ?? createdAt,
      hash: await dedupHash(date, item.amount, item.merchant),
    });
  }

  const existingIdSet = await existingIds(db, "transactions", valid.filter((v) => v.given).map((v) => v.id));
  // 既存の取引の dedup_hash → 最も古い取引の id
  const existingHash = new Map<string, string>();
  for (const part of chunks([...new Set(valid.map((v) => v.hash))], IN_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT id, dedup_hash FROM transactions WHERE dedup_hash IN (${part.map(() => "?").join(",")}) ORDER BY created_at`)
      .bind(...part)
      .all<{ id: string; dedup_hash: string }>();
    for (const r of results) if (!existingHash.has(r.dedup_hash)) existingHash.set(r.dedup_hash, r.id);
  }

  const seenIds = new Set<string>();
  const seenHash = new Map<string, string>();
  const pending: Pending[] = [];
  for (const v of valid) {
    if (existingIdSet.has(v.id) || seenIds.has(v.id)) {
      report(v.entry, { status: "skipped_exists", id: v.id, message: `id「${v.id}」の取引は既にあるためスキップしました` });
      continue;
    }
    if (!v.item.allow_duplicate && !v.isBackup) {
      const dupOf = existingHash.get(v.hash) ?? seenHash.get(v.hash);
      if (dupOf) {
        report(v.entry, {
          status: "skipped_duplicate",
          id: dupOf,
          message: `同じ日付・金額・店名の取引(id「${dupOf}」)があるため重複としてスキップしました。別の買い物なら allow_duplicate:true を付けてください`,
        });
        continue;
      }
    }
    seenIds.add(v.id);
    if (!seenHash.has(v.hash)) seenHash.set(v.hash, v.id);
    pending.push({
      entry: v.entry,
      id: v.id,
      statement: db
        .prepare(
          `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          v.id,
          v.date,
          v.item.amount,
          v.item.merchant ?? null,
          v.item.category ? categories.get(v.item.category)! : null,
          v.item.account ? accounts.get(v.item.account)! : null,
          v.item.memo ?? null,
          v.item.source,
          v.status,
          v.hash,
          v.createdAt,
          v.updatedAt,
        ),
    });
  }
  await insertAll(db, pending, report);
}

async function importAttachments(db: D1Database, entries: Entry[], report: Report, nowIso: string): Promise<void> {
  if (entries.length === 0) return;
  const valid: { entry: Entry; id: string; given: boolean; data: z.infer<typeof attachmentSchema> }[] = [];
  for (const entry of entries) {
    const a = attachmentSchema.safeParse(entry.record);
    if (!a.success) {
      report(entry, { status: "error", message: joinMessages(toFieldErrors(a.error)) });
      continue;
    }
    valid.push({ entry, id: a.data.id ?? crypto.randomUUID(), given: a.data.id !== undefined, data: a.data });
  }

  // 取引と出来事は先に取り込み済みなので、DBを見れば参照先の有無が分かる
  const [existing, txIds, eventIds] = await Promise.all([
    existingIds(db, "attachments", valid.filter((v) => v.given).map((v) => v.id)),
    existingIds(db, "transactions", valid.flatMap((v) => (v.data.transaction_id ? [v.data.transaction_id] : []))),
    existingIds(db, "events", valid.flatMap((v) => (v.data.event_id ? [v.data.event_id] : []))),
  ]);

  const seen = new Set<string>();
  const pending: Pending[] = [];
  for (const v of valid) {
    if (existing.has(v.id) || seen.has(v.id)) {
      report(v.entry, { status: "skipped_exists", id: v.id, message: `id「${v.id}」の添付は既にあるためスキップしました` });
      continue;
    }
    const errors: string[] = [];
    if (v.data.transaction_id && !txIds.has(v.data.transaction_id)) {
      errors.push(`transaction_id: 「${v.data.transaction_id}」という取引はありません。先に取引を取り込むか、id を確認してください`);
    }
    if (v.data.event_id && !eventIds.has(v.data.event_id)) {
      errors.push(`event_id: 「${v.data.event_id}」という出来事はありません。先に出来事を取り込むか、id を確認してください`);
    }
    if (errors.length > 0) {
      report(v.entry, { status: "error", message: errors.join(" / ") });
      continue;
    }
    seen.add(v.id);
    pending.push({
      entry: v.entry,
      id: v.id,
      statement: db
        .prepare("INSERT INTO attachments (id, r2_key, date, transaction_id, event_id, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(v.id, v.data.r2_key, v.data.date ?? null, v.data.transaction_id ?? null, v.data.event_id ?? null, v.data.caption ?? null, v.data.created_at ?? nowIso),
    });
  }
  await insertAll(db, pending, report);
}

async function importLinks(db: D1Database, entries: Entry[], report: Report, nowIso: string): Promise<void> {
  if (entries.length === 0) return;
  const valid: { entry: Entry; id: string; given: boolean; url: string; kind: string; data: z.infer<typeof linkSchema> }[] = [];
  for (const entry of entries) {
    const l = linkSchema.safeParse(entry.record);
    if (!l.success) {
      report(entry, { status: "error", message: joinMessages(toFieldErrors(l.error)) });
      continue;
    }
    const url = parseLinkUrl(l.data.url);
    if (!url.ok) {
      report(entry, { status: "error", message: `url: ${url.message}` });
      continue;
    }
    if (l.data.kind && l.data.kind !== url.kind) {
      report(entry, { status: "error", message: `kind: 「${l.data.kind}」はURLの種類(${url.kind})と合いません` });
      continue;
    }
    valid.push({ entry, id: l.data.id ?? crypto.randomUUID(), given: l.data.id !== undefined, url: url.url, kind: url.kind, data: l.data });
  }

  const [existing, txIds, eventIds] = await Promise.all([
    existingIds(db, "links", valid.filter((v) => v.given).map((v) => v.id)),
    existingIds(db, "transactions", valid.flatMap((v) => (v.data.transaction_id ? [v.data.transaction_id] : []))),
    existingIds(db, "events", valid.flatMap((v) => (v.data.event_id ? [v.data.event_id] : []))),
  ]);
  // 同じ紐づけ先に同じ正規化URLがあれば重複(id が違っても)。キー → 既存のリンクの id
  const key = (url: string, date?: string | null, tx?: string | null, ev?: string | null) => JSON.stringify([url, date ?? null, tx ?? null, ev ?? null]);
  const sameUrl = new Map<string, string>();
  for (const part of chunks([...new Set(valid.map((v) => v.url))], IN_CHUNK)) {
    const { results } = await db
      .prepare(`SELECT id, url, date, transaction_id, event_id FROM links WHERE url IN (${part.map(() => "?").join(",")}) ORDER BY created_at, id`)
      .bind(...part)
      .all<{ id: string; url: string; date: string | null; transaction_id: string | null; event_id: string | null }>();
    for (const r of results) {
      const k = key(r.url, r.date, r.transaction_id, r.event_id);
      if (!sameUrl.has(k)) sameUrl.set(k, r.id);
    }
  }

  const seen = new Set<string>();
  const pending: Pending[] = [];
  for (const v of valid) {
    if (existing.has(v.id) || seen.has(v.id)) {
      report(v.entry, { status: "skipped_exists", id: v.id, message: `id「${v.id}」のリンクは既にあるためスキップしました` });
      continue;
    }
    const errors: string[] = [];
    if (v.data.transaction_id && !txIds.has(v.data.transaction_id)) {
      errors.push(`transaction_id: 「${v.data.transaction_id}」という取引はありません。先に取引を取り込むか、id を確認してください`);
    }
    if (v.data.event_id && !eventIds.has(v.data.event_id)) {
      errors.push(`event_id: 「${v.data.event_id}」という出来事はありません。先に出来事を取り込むか、id を確認してください`);
    }
    if (errors.length > 0) {
      report(v.entry, { status: "error", message: errors.join(" / ") });
      continue;
    }
    const k = key(v.url, v.data.date, v.data.transaction_id, v.data.event_id);
    const dupOf = sameUrl.get(k);
    if (dupOf) {
      report(v.entry, { status: "skipped_duplicate", id: dupOf, message: `同じ紐づけ先に同じリンク(id「${dupOf}」)があるため重複としてスキップしました` });
      continue;
    }
    seen.add(v.id);
    sameUrl.set(k, v.id);
    pending.push({
      entry: v.entry,
      id: v.id,
      statement: db
        .prepare("INSERT INTO links (id, url, kind, title, date, transaction_id, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(v.id, v.url, v.kind, v.data.title ?? null, v.data.date ?? null, v.data.transaction_id ?? null, v.data.event_id ?? null, v.data.created_at ?? nowIso),
    });
  }
  await insertAll(db, pending, report);
}

/**
 * JSONL(または JSON 配列)を取り込む。行ごとに結果を返し、一部の行がエラーでも他の行は取り込む。
 * 順序はファイル内の順に関係なく event → transaction → attachment → link(外部キーの都合)。結果は元の行の順。
 */
export async function importRecords(db: D1Database, text: string, options: ImportOptions = {}): Promise<ImportResponse> {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    return tooLarge("本文が大きすぎます(上限は5MB)。ファイルを分けて送ってください");
  }
  const parsed = parseEntries(text);
  if ("error" in parsed) return parsed.error;
  const { entries } = parsed;
  const now = options.now ?? new Date();

  const results: ImportResult[] = new Array<ImportResult>(entries.length);
  const report: Report = (entry, result) => {
    results[entry.index] = { line: entry.line, type: entry.type, ...result };
  };

  const byType: Record<RecordType, Entry[]> = { event: [], transaction: [], attachment: [], link: [] };
  for (const entry of entries) {
    if (entry.parseError) {
      report(entry, { status: "error", message: entry.parseError });
      continue;
    }
    if (!entry.record) {
      report(entry, { status: "error", message: "オブジェクト({...})ではありません。1レコードを1つのJSONオブジェクトで書いてください" });
      continue;
    }
    const { type, ...rest } = entry.record;
    if (type === undefined || type === null) {
      report(entry, { status: "error", message: `type がありません。"type" に ${RECORD_TYPES.join(" / ")} のいずれかを指定してください` });
      continue;
    }
    if (typeof type !== "string" || !(RECORD_TYPES as readonly string[]).includes(type)) {
      report(
        { ...entry, type: typeof type === "string" ? type : null },
        { status: "error", message: `type: 「${String(type)}」は未対応です。${RECORD_TYPES.join(" / ")} のいずれかを指定してください` },
      );
      continue;
    }
    // null の項目は「値なし」として省略扱いにする(エクスポートが null を出すため)
    const cleaned = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
    byType[type as RecordType].push({ ...entry, type, record: cleaned });
  }

  const nowIso = now.toISOString();
  await importEvents(db, byType.event, report, nowIso);
  await importTransactions(db, byType.transaction, report, now);
  await importAttachments(db, byType.attachment, report, nowIso);
  await importLinks(db, byType.link, report, nowIso);

  const summary: ImportSummary = { total: results.length, ok: 0, skipped: 0, errors: 0 };
  for (const r of results) {
    if (r.status === "ok") summary.ok++;
    else if (r.status === "error") summary.errors++;
    else summary.skipped++;
  }
  return { ok: true, summary, results };
}
