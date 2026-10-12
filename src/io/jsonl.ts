import { z } from "zod";
import { todayJst } from "../core/dates";
import { needsReview } from "../core/items";
import { RECEIPT_DETAIL_KEYS } from "../core/receipt-details";
import {
  eventInputSchema,
  isoDate,
  itemInputSchema,
  itemsTotalMismatch,
  MAX_ITEMS,
  toFieldErrors,
  transactionInputSchema,
  type EventInput,
  type FieldError,
  type ItemInput,
  type TransactionInput,
} from "../core/schema";
import { categoryNameField } from "../core/categories";
import { parseLinkUrl, MAX_URL_LENGTH } from "../core/links";
import { MAX_NOTE_LENGTH, MAX_SCREEN_LENGTH, MAX_SEAT_LENGTH, MAX_TITLE_LENGTH, MAX_VENUE_LENGTH } from "../core/seat-records";
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
                 t.memo, t.source, t.status, t.tax_flag, t.paid_time, t.merchant_phone, t.merchant_address, t.invoice_number, t.clerk_name, t.receipt_no,
                 t.created_at, t.updated_at
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          LEFT JOIN accounts a ON a.id = t.account_id
          WHERE t.id > ? ORDER BY t.id LIMIT ?`,
  },
  {
    sql: `SELECT 'item' AS type, i.id, i.transaction_id, i.position, i.name, i.amount, c.name AS category, i.tax_flag, i.memo, i.created_at
          FROM transaction_items i
          LEFT JOIN categories c ON c.id = i.category_id
          WHERE i.id > ? ORDER BY i.id LIMIT ?`,
  },
  {
    sql: `SELECT 'attachment' AS type, id, r2_key, date, transaction_id, event_id, caption, created_at
          FROM attachments WHERE id > ? ORDER BY id LIMIT ?`,
  },
  {
    sql: `SELECT 'link' AS type, id, url, kind, title, date, transaction_id, event_id, created_at
          FROM links WHERE id > ? ORDER BY id LIMIT ?`,
  },
  {
    sql: `SELECT 'seat_record' AS type, id, date, title, venue, screen, seat, rating, note, transaction_id, created_at
          FROM seat_records WHERE id > ? ORDER BY id LIMIT ?`,
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
 * 全データをJSONL(1行1レコード)で返す。event → transaction → item(明細)→ attachment → link → seat_record の順(外部キーの順)。
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

const RECORD_TYPES = ["event", "transaction", "item", "attachment", "link", "seat_record"] as const;
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

// 明細の行。取引の行(同じファイルの、id が transaction_id と一致するもの)といっしょに取り込む
const itemLineSchema = itemInputSchema.extend({
  id: idField.optional(),
  transaction_id: idField,
  position: z.number().int().min(0).max(MAX_ITEMS - 1).optional(),
  created_at: timestampField.optional(),
});

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

// 座席の記録。core の座席の記録と同じ上限・トリム。評価は1〜5の整数
const seatRecordSchema = z.strictObject({
  id: idField.optional(),
  date: isoDate,
  // 旧形式(title なし)の行も取り込める。空文字は未指定(NULL)
  title: z.string().trim().max(MAX_TITLE_LENGTH).optional(),
  venue: z.string().trim().min(1).max(MAX_VENUE_LENGTH),
  screen: z.string().trim().min(1).max(MAX_SCREEN_LENGTH).optional(),
  seat: z.string().trim().min(1).max(MAX_SEAT_LENGTH),
  rating: z.number().int().min(1, "1〜5の整数にしてください").max(5, "1〜5の整数にしてください").optional(),
  note: z.string().trim().min(1).max(MAX_NOTE_LENGTH).optional(),
  transaction_id: z.string().min(1).optional(),
  created_at: timestampField.optional(),
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

async function existingIds(db: D1Database, table: "events" | "transactions" | "transaction_items" | "attachments" | "links" | "seat_records", ids: string[]): Promise<Set<string>> {
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
  // 1レコードぶんの文(取引なら、取引と明細の INSERT)。いっしょに成功するか、いっしょに失敗する
  statements: D1PreparedStatement[];
  // いっしょに書き込む子の行(取引の明細)。結果は親と同じになる
  children?: { entry: Entry; id: string }[];
}

type Report = (entry: Entry, result: Omit<ImportResult, "line" | "type">) => void;

// 文の数で、batch の上限を超えないよう分ける(1レコードが上限より多い文を持つときは、それだけで1つ)
function batchesOf(pending: Pending[]): Pending[][] {
  const out: Pending[][] = [];
  let current: Pending[] = [];
  let size = 0;
  for (const p of pending) {
    if (current.length > 0 && size + p.statements.length > BATCH_SIZE) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.statements.length;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function reportPending(report: Report, p: Pending, result: Omit<ImportResult, "line" | "type" | "id">) {
  report(p.entry, { ...result, ...(result.status === "ok" ? { id: p.id } : {}) });
  for (const child of p.children ?? []) report(child.entry, { ...result, ...(result.status === "ok" ? { id: child.id } : {}) });
}

// D1の batch で、上限を超えないよう分割して書き込む。batch が失敗したら1レコードずつ試して、失敗したレコードだけをエラーにする
async function insertAll(db: D1Database, pending: Pending[], report: Report): Promise<void> {
  for (const part of batchesOf(pending)) {
    try {
      await db.batch(part.flatMap((p) => p.statements));
      for (const p of part) reportPending(report, p, { status: "ok" });
    } catch {
      for (const p of part) {
        try {
          await db.batch(p.statements);
          reportPending(report, p, { status: "ok" });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          reportPending(report, p, { status: "error", message: `書き込みに失敗しました(${reason})` });
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
      statements: [
        db
          .prepare("INSERT INTO events (id, start_date, end_date, title, note, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(v.id, v.data.start_date, v.data.end_date ?? null, v.data.title, v.data.note ?? null, v.data.color, v.createdAt, v.updatedAt),
      ],
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

// バックアップの復元で、取り込み先に無いカテゴリを自動で作るときの大分類(行には大分類が入っていない)
export const RESTORED_CATEGORY_GROUP = "その他";

interface ItemLine {
  entry: Entry;
  id: string;
  given: boolean;
  transactionId: string;
  position: number | undefined;
  order: number;
  data: ItemInput;
  createdAt: string | undefined;
}

// 明細の行を検証して、取引の id ごとにまとめる(並びは position、無ければファイルの順)
function groupItemLines(itemEntries: Entry[], report: Report): Map<string, ItemLine[]> {
  const byTx = new Map<string, ItemLine[]>();
  itemEntries.forEach((entry, order) => {
    const r = itemLineSchema.safeParse(entry.record);
    if (!r.success) {
      report(entry, { status: "error", message: joinMessages(toFieldErrors(r.error)) });
      return;
    }
    const { id, transaction_id: transactionId, position, created_at: createdAt, ...data } = r.data;
    const list = byTx.get(transactionId) ?? [];
    list.push({ entry, id: id ?? crypto.randomUUID(), given: id !== undefined, transactionId, position, order, data, createdAt });
    byTx.set(transactionId, list);
  });
  for (const list of byTx.values()) {
    list.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.order - b.order);
  }
  return byTx;
}

async function importTransactions(db: D1Database, entries: Entry[], itemEntries: Entry[], report: Report, now: Date): Promise<void> {
  if (entries.length === 0 && itemEntries.length === 0) return;
  const nowIso = now.toISOString();
  const today = todayJst(now);
  const [categories, accounts] = await Promise.all([loadNames(db, "categories"), loadNames(db, "accounts")]);
  // バックアップ行(id と created_at がある)に出てきた、取り込み先に無いカテゴリ名 → 作るときの id
  const restoredCategories = new Map<string, string>();
  const itemsByTx = groupItemLines(itemEntries, report);
  // 取引の行に結びついた明細のまとまり(取引の id)。残ったものは、対応する取引の行が無い明細
  const claimed = new Set<string>();

  // 取り込めない取引の明細は、同じ理由でエラーにする
  const failItems = (entry: Entry, lines: ItemLine[], reason: string) => {
    for (const l of lines) report(l.entry, { status: "error", message: `取引の行(${entry.line}行目)を取り込めないため、この明細も取り込みませんでした: ${reason}` });
  };

  const valid: {
    entry: Entry;
    id: string;
    given: boolean;
    isBackup: boolean;
    item: TransactionInput;
    lines: ItemLine[];
    date: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    hash: string;
  }[] = [];
  for (const entry of entries) {
    const { extras, rest } = splitExtras(entry.record!, ["id", "status", "created_at", "updated_at"]);
    const e = transactionExtrasSchema.safeParse(extras);
    const givenId = e.success ? e.data.id : undefined;
    const lines = givenId !== undefined && !claimed.has(givenId) ? (itemsByTx.get(givenId) ?? []) : [];
    if (givenId !== undefined) claimed.add(givenId);
    if ("items" in rest) {
      const reason = 'items: 明細は取引の行には書けません。type が "item" の行(transaction_id に取引の id)で書いてください';
      report(entry, { status: "error", message: reason });
      failItems(entry, lines, reason);
      continue;
    }
    const d = transactionInputSchema.safeParse(rest);
    if (!e.success || !d.success) {
      const errors = [...(e.success ? [] : toFieldErrors(e.error)), ...(d.success ? [] : toFieldErrors(d.error))];
      report(entry, { status: "error", message: joinMessages(errors) });
      failItems(entry, lines, "取引の行の検証エラー");
      continue;
    }
    const item = d.data;
    const isBackup = e.data.id !== undefined && e.data.created_at !== undefined;
    const errors: string[] = [];
    if (item.date && item.date > today) errors.push(`date: 未来の日付(${item.date})は取り込めません。今日は ${today} です`);
    // 取引と明細のカテゴリを確かめる。復元では、元のカテゴリを再現するために自動で作る。名前が規則(30文字・前後の空白なし)に合うものだけ
    const checkCategory = (name: string, field: string) => {
      if (categories.has(name)) return;
      const restorable = isBackup && categoryNameField("category").safeParse(name).data === name;
      if (restorable) {
        if (!restoredCategories.has(name)) restoredCategories.set(name, `cat_${crypto.randomUUID()}`);
      } else {
        errors.push(unknownName(field, "カテゴリ", name, categories));
      }
    };
    if (item.category) checkCategory(item.category, "category");
    for (const l of lines) if (l.data.category) checkCategory(l.data.category, `items(${l.entry.line}行目).category`);
    if (item.account && !accounts.has(item.account)) errors.push(unknownName("account", "口座", item.account, accounts));
    if (lines.length > MAX_ITEMS) errors.push(`items: 明細が${lines.length}行あります。1取引あたり${MAX_ITEMS}行までです`);
    const mismatch = itemsTotalMismatch(item.amount, lines.map((l) => l.data));
    if (mismatch) errors.push(`items: ${mismatch}`);
    if (errors.length > 0) {
      report(entry, { status: "error", message: errors.join(" / ") });
      failItems(entry, lines, errors.join(" / "));
      continue;
    }
    const date = item.date ?? today;
    const createdAt = e.data.created_at ?? nowIso;
    valid.push({
      entry,
      id: e.data.id ?? crypto.randomUUID(),
      given: e.data.id !== undefined,
      // id と created_at の両方があるのは、エクスポート由来のバックアップ行
      isBackup,
      item,
      lines,
      date,
      status: e.data.status ?? (needsReview(item.merchant, item.category, lines.map((l) => l.data)) ? "needs_review" : "ok"),
      createdAt,
      updatedAt: e.data.updated_at ?? createdAt,
      hash: await dedupHash(date, item.amount, item.merchant, item.paid_time),
    });
  }

  const [existingIdSet, existingItemIds] = await Promise.all([
    existingIds(db, "transactions", valid.filter((v) => v.given).map((v) => v.id)),
    existingIds(db, "transaction_items", [...itemsByTx.values()].flat().filter((l) => l.given).map((l) => l.id)),
  ]);
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
  const seenItemIds = new Set<string>();
  const seenHash = new Map<string, string>();
  const pending: Pending[] = [];
  // 実際に取り込む行が使う、自動作成のカテゴリ(取り込まれない行のぶんは作らない)
  const createStatements = new Map<string, D1PreparedStatement>();
  const useCategory = (name: string | undefined | null): string | null => {
    if (!name) return null;
    const restoredId = restoredCategories.get(name);
    if (!categories.has(name) && restoredId && !createStatements.has(name)) {
      createStatements.set(name, db.prepare("INSERT INTO categories (id, name, group_name) VALUES (?, ?, ?)").bind(restoredId, name, RESTORED_CATEGORY_GROUP));
    }
    return categories.get(name) ?? restoredId!;
  };
  for (const v of valid) {
    if (existingIdSet.has(v.id) || seenIds.has(v.id)) {
      report(v.entry, { status: "skipped_exists", id: v.id, message: `id「${v.id}」の取引は既にあるためスキップしました` });
      for (const l of v.lines) report(l.entry, { status: "skipped_exists", id: l.id, message: `取引「${v.id}」が既にあるため、この明細もスキップしました` });
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
        for (const l of v.lines) report(l.entry, { status: "skipped_duplicate", id: dupOf, message: "取引が重複としてスキップされたため、この明細もスキップしました" });
        continue;
      }
    }
    const takenItem = v.lines.find((l) => existingItemIds.has(l.id) || seenItemIds.has(l.id));
    if (takenItem) {
      const reason = `明細の id「${takenItem.id}」が既にあります。明細の id を変えるか省いてください`;
      report(v.entry, { status: "error", message: reason });
      failItems(v.entry, v.lines, reason);
      continue;
    }
    seenIds.add(v.id);
    for (const l of v.lines) seenItemIds.add(l.id);
    if (!seenHash.has(v.hash)) seenHash.set(v.hash, v.id);
    const categoryId = useCategory(v.item.category);
    pending.push({
      entry: v.entry,
      id: v.id,
      children: v.lines.map((l) => ({ entry: l.entry, id: l.id })),
      statements: [
        db
          .prepare(
            `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag,
                                        paid_time, merchant_phone, merchant_address, invoice_number, clerk_name, receipt_no)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            v.id,
            v.date,
            v.item.amount,
            v.item.merchant ?? null,
            categoryId,
            v.item.account ? accounts.get(v.item.account)! : null,
            v.item.memo ?? null,
            v.item.source,
            v.status,
            v.hash,
            v.createdAt,
            v.updatedAt,
            v.item.tax_flag ?? null,
            ...RECEIPT_DETAIL_KEYS.map((k) => v.item[k] ?? null),
          ),
        // 明細は、取引と同じ batch で書く(取引だけ・明細だけが残らない)。position は並べ直した順(0 始まり)
        ...v.lines.map((l, position) =>
          db
            .prepare(
              `INSERT INTO transaction_items (id, transaction_id, position, name, amount, category_id, tax_flag, memo, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(l.id, v.id, position, l.data.name, l.data.amount, useCategory(l.data.category), l.data.tax_flag ?? null, l.data.memo ?? null, l.createdAt ?? v.createdAt),
        ),
      ],
    });
  }

  // 取引の行が見つからない明細。同じ id の明細が既にあれば(同じバックアップを2回戻したなど)スキップ、無ければエラー
  for (const [txId, lines] of itemsByTx) {
    if (claimed.has(txId)) continue;
    for (const l of lines) {
      if (l.given && existingItemIds.has(l.id)) {
        report(l.entry, { status: "skipped_exists", id: l.id, message: `id「${l.id}」の明細は既にあるためスキップしました` });
      } else {
        report(l.entry, {
          status: "error",
          message: `transaction_id: 「${txId}」の取引の行がこのファイルにありません。明細は、取引の行(type: "transaction"、同じ id)といっしょに取り込みます`,
        });
      }
    }
  }

  // カテゴリを先に作る(取引の外部キーのため)。同じ名前が同時に作られて失敗したら、この回は取引ごとエラーにする
  if (createStatements.size > 0) {
    try {
      await db.batch([...createStatements.values()]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      for (const p of pending) reportPending(report, p, { status: "error", message: `カテゴリを作成できませんでした(${reason})` });
      return;
    }
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
      statements: [
        db
          .prepare("INSERT INTO attachments (id, r2_key, date, transaction_id, event_id, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(v.id, v.data.r2_key, v.data.date ?? null, v.data.transaction_id ?? null, v.data.event_id ?? null, v.data.caption ?? null, v.data.created_at ?? nowIso),
      ],
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
      statements: [
        db
          .prepare("INSERT INTO links (id, url, kind, title, date, transaction_id, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(v.id, v.url, v.kind, v.data.title ?? null, v.data.date ?? null, v.data.transaction_id ?? null, v.data.event_id ?? null, v.data.created_at ?? nowIso),
      ],
    });
  }
  await insertAll(db, pending, report);
}

async function importSeatRecords(db: D1Database, entries: Entry[], report: Report, nowIso: string): Promise<void> {
  if (entries.length === 0) return;
  const valid: { entry: Entry; id: string; given: boolean; data: z.infer<typeof seatRecordSchema> }[] = [];
  for (const entry of entries) {
    const r = seatRecordSchema.safeParse(entry.record);
    if (!r.success) {
      report(entry, { status: "error", message: joinMessages(toFieldErrors(r.error)) });
      continue;
    }
    valid.push({ entry, id: r.data.id ?? crypto.randomUUID(), given: r.data.id !== undefined, data: r.data });
  }

  // 取引は先に取り込み済みなので、DBを見れば参照先の有無が分かる
  const [existing, txIds] = await Promise.all([
    existingIds(db, "seat_records", valid.filter((v) => v.given).map((v) => v.id)),
    existingIds(db, "transactions", valid.flatMap((v) => (v.data.transaction_id ? [v.data.transaction_id] : []))),
  ]);

  const seen = new Set<string>();
  const pending: Pending[] = [];
  for (const v of valid) {
    if (existing.has(v.id) || seen.has(v.id)) {
      report(v.entry, { status: "skipped_exists", id: v.id, message: `id「${v.id}」の座席の記録は既にあるためスキップしました` });
      continue;
    }
    if (v.data.transaction_id && !txIds.has(v.data.transaction_id)) {
      report(v.entry, {
        status: "error",
        message: `transaction_id: 「${v.data.transaction_id}」という取引はありません。先に取引を取り込むか、id を確認してください`,
      });
      continue;
    }
    seen.add(v.id);
    pending.push({
      entry: v.entry,
      id: v.id,
      statements: [
        db
          .prepare("INSERT INTO seat_records (id, date, title, venue, screen, seat, rating, note, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(v.id, v.data.date, v.data.title || null, v.data.venue, v.data.screen ?? null, v.data.seat, v.data.rating ?? null, v.data.note ?? null, v.data.transaction_id ?? null, v.data.created_at ?? nowIso),
      ],
    });
  }
  await insertAll(db, pending, report);
}

/**
 * JSONL(または JSON 配列)を取り込む。行ごとに結果を返し、一部の行がエラーでも他の行は取り込む。
 * 順序はファイル内の順に関係なく event → transaction(と、その明細の item)→ attachment → link → seat_record(外部キーの都合)。結果は元の行の順。
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

  const byType: Record<RecordType, Entry[]> = { event: [], transaction: [], item: [], attachment: [], link: [], seat_record: [] };
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
  await importTransactions(db, byType.transaction, byType.item, report, now);
  await importAttachments(db, byType.attachment, report, nowIso);
  await importLinks(db, byType.link, report, nowIso);
  await importSeatRecords(db, byType.seat_record, report, nowIso);

  const summary: ImportSummary = { total: results.length, ok: 0, skipped: 0, errors: 0 };
  for (const r of results) {
    if (r.status === "ok") summary.ok++;
    else if (r.status === "error") summary.errors++;
    else summary.skipped++;
  }
  return { ok: true, summary, results };
}
