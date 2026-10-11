import { todayJst } from "./dates";
import {
  addTransactionsEnvelopeSchema,
  listTransactionsSchema,
  transactionInputSchema,
  toFieldErrors,
  type FieldError,
  type TransactionInput,
} from "./schema";
import { ANY_TAX_FLAG, type TaxFlag } from "./tax-flags";
import { deleteTransactionSchema, updateTransactionSchema } from "./transaction-edit-schema";

export interface CoreOptions {
  now?: Date;
}

export interface TransactionView {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
  category: string | null;
  account: string | null;
  memo: string | null;
  source: string;
  status: string;
  tax_flag: TaxFlag | null;
}

// 取引の表示用の列(TransactionView と同じ並び)。transactions を t、カテゴリを c、口座を a で JOIN して使う
export const TX_VIEW_COLUMNS = "t.id, t.date, t.amount, t.merchant, c.name AS category, a.name AS account, t.memo, t.source, t.status, t.tax_flag";

export interface DuplicateInfo {
  index: number;
  existing_id?: string;
  duplicate_of_index?: number;
}

export type AddResult =
  | { ok: true; registered: TransactionView[]; skipped_duplicates: DuplicateInfo[]; message: string }
  | { ok: false; errors: FieldError[] };

export type ListResult =
  | { ok: true; transactions: TransactionView[]; count: number }
  | { ok: false; errors: FieldError[] };

interface NamedRow {
  id: string;
  name: string;
}

// 日付+金額+正規化した店名のSHA-256。店名は全角半角・大文字小文字・空白の違いを吸収する
export async function dedupHash(date: string, amount: number, merchant: string | undefined): Promise<string> {
  const normalized = (merchant ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const data = new TextEncoder().encode(`${date}|${amount}|${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadNames(db: D1Database, table: "categories" | "accounts"): Promise<Map<string, string>> {
  const { results } = await db.prepare(`SELECT id, name FROM ${table} ORDER BY rowid`).all<NamedRow>();
  return new Map(results.map((r) => [r.name, r.id]));
}

function unknownName(field: "category" | "account", label: string, value: string, names: Map<string, string>): string {
  return `${field}: 「${value}」という${label}はありません。選べる値: ${[...names.keys()].join("、")}`;
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const label = (t: { merchant: string | null; amount: number }) => `${t.merchant ?? "(店名なし)"} ${yen(t.amount)}`;

export async function addTransactions(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<AddResult> {
  const envelope = addTransactionsEnvelopeSchema.safeParse(input);
  if (!envelope.success) return { ok: false, errors: toFieldErrors(envelope.error) };

  const now = options.now ?? new Date();
  const today = todayJst(now);
  const errors: FieldError[] = [];
  const valid: { index: number; item: TransactionInput }[] = [];
  envelope.data.transactions.forEach((raw, index) => {
    const item = transactionInputSchema.safeParse(raw);
    if (item.success) valid.push({ index, item: item.data });
    else errors.push(...toFieldErrors(item.error, index));
  });
  const [categories, accounts] = await Promise.all([loadNames(db, "categories"), loadNames(db, "accounts")]);

  valid.forEach(({ index, item }) => {
    if (item.date && item.date > today) {
      errors.push({ index, field: "date", message: `date: 未来の日付(${item.date})は登録できません。今日は ${today} です` });
    }
    if (item.category && !categories.has(item.category)) {
      errors.push({ index, field: "category", message: unknownName("category", "カテゴリ", item.category, categories) });
    }
    if (item.account && !accounts.has(item.account)) {
      errors.push({ index, field: "account", message: unknownName("account", "口座", item.account, accounts) });
    }
  });
  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => (a.index ?? -1) - (b.index ?? -1)) };
  // ここまで来たら全件が正しいので、valid の並びは元の配列と同じ(indexが一致する)
  const items = valid.map((v) => v.item);

  const prepared = await Promise.all(
    items.map(async (item) => ({ item, date: item.date ?? today, hash: await dedupHash(item.date ?? today, item.amount, item.merchant) })),
  );

  const existing = new Map<string, string>();
  const hashes = [...new Set(prepared.map((p) => p.hash))];
  const { results } = await db
    .prepare(`SELECT id, dedup_hash FROM transactions WHERE dedup_hash IN (${hashes.map(() => "?").join(",")}) ORDER BY created_at`)
    .bind(...hashes)
    .all<{ id: string; dedup_hash: string }>();
  for (const row of results) if (!existing.has(row.dedup_hash)) existing.set(row.dedup_hash, row.id);

  const skipped: DuplicateInfo[] = [];
  const registered: TransactionView[] = [];
  const statements: D1PreparedStatement[] = [];
  const seenInBatch = new Map<string, number>();
  const timestamp = now.toISOString();

  prepared.forEach(({ item, date, hash }, index) => {
    if (!item.allow_duplicate) {
      const existingId = existing.get(hash);
      if (existingId) {
        skipped.push({ index, existing_id: existingId });
        return;
      }
      const firstIndex = seenInBatch.get(hash);
      if (firstIndex !== undefined) {
        skipped.push({ index, duplicate_of_index: firstIndex });
        return;
      }
    }
    if (!seenInBatch.has(hash)) seenInBatch.set(hash, index);

    const id = crypto.randomUUID();
    const status = needsReview(item) ? "needs_review" : "ok";
    statements.push(
      db
        .prepare(
          `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          date,
          item.amount,
          item.merchant ?? null,
          item.category ? categories.get(item.category)! : null,
          item.account ? accounts.get(item.account)! : null,
          item.memo ?? null,
          item.source,
          status,
          hash,
          timestamp,
          timestamp,
          item.tax_flag ?? null,
        ),
    );
    registered.push({
      id,
      date,
      amount: item.amount,
      merchant: item.merchant ?? null,
      category: item.category ?? null,
      account: item.account ?? null,
      memo: item.memo ?? null,
      source: item.source,
      status,
      tax_flag: item.tax_flag ?? null,
    });
  });

  // 全件成功か全件ロールバック(D1のbatchはトランザクションとして実行される)
  if (statements.length > 0) await db.batch(statements);

  return { ok: true, registered, skipped_duplicates: skipped, message: buildMessage(registered, skipped, prepared) };
}

// 店名かカテゴリが空なら、後で見直す対象にする
function needsReview(item: TransactionInput): boolean {
  return !item.merchant || !item.category;
}

function buildMessage(
  registered: TransactionView[],
  skipped: DuplicateInfo[],
  prepared: { item: TransactionInput; date: string }[],
): string {
  const parts: string[] = [];
  parts.push(registered.length > 0 ? `${registered.length}件登録しました: ${registered.map(label).join(" / ")}` : "登録した取引はありません");
  if (skipped.length > 0) {
    const names = skipped.map((s) => label({ merchant: prepared[s.index]?.item.merchant ?? null, amount: prepared[s.index]?.item.amount ?? 0 }));
    parts.push(`重複の疑いで${skipped.length}件は登録しませんでした(${names.join(" / ")})。別の買い物なら allow_duplicate:true で再送してください`);
  }
  const review = registered.filter((r) => r.status === "needs_review").length;
  if (review > 0) parts.push(`${review}件は店名またはカテゴリが空のため needs_review にしました`);
  return parts.join("。");
}

export async function listTransactions(db: D1Database, input: unknown): Promise<ListResult> {
  const parsed = listTransactionsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { from, to, category, tax_flag: taxFlag, limit } = parsed.data;

  if (from && to && from > to) {
    return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };
  }

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (from) {
    where.push("t.date >= ?");
    params.push(from);
  }
  if (to) {
    where.push("t.date <= ?");
    params.push(to);
  }
  if (category) {
    const categories = await loadNames(db, "categories");
    const id = categories.get(category);
    if (!id) return { ok: false, errors: [{ field: "category", message: unknownName("category", "カテゴリ", category, categories) }] };
    where.push("t.category_id = ?");
    params.push(id);
  }
  if (taxFlag === ANY_TAX_FLAG) {
    where.push("t.tax_flag IS NOT NULL");
  } else if (taxFlag) {
    where.push("t.tax_flag = ?");
    params.push(taxFlag);
  }

  const { results } = await db
    .prepare(
      `SELECT ${TX_VIEW_COLUMNS}
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY t.date DESC, t.created_at DESC, t.id
       LIMIT ?`,
    )
    .bind(...params, limit)
    .all<TransactionView>();

  return { ok: true, transactions: results, count: results.length };
}

export interface DuplicateWarning {
  duplicate_of: string;
  message: string;
}

export type UpdateResult =
  | { ok: true; transaction: TransactionView; warnings: DuplicateWarning[]; message: string }
  | { ok: false; errors: FieldError[] };

export type DeleteResult =
  | { ok: true; deleted: TransactionView; message: string }
  | { ok: false; errors: FieldError[] };

const VIEW_SELECT = `SELECT ${TX_VIEW_COLUMNS}
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ?`;

const notFound = (id: string): FieldError[] => [
  { field: "id", message: `id: 「${id}」という取引はありません。list_transactions で id を確認してください` },
];

export async function updateTransaction(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<UpdateResult> {
  const parsed = updateTransactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const patch = parsed.data;

  const current = await db.prepare(VIEW_SELECT).bind(patch.id).first<TransactionView>();
  if (!current) return { ok: false, errors: notFound(patch.id) };

  const now = options.now ?? new Date();
  const today = todayJst(now);
  const errors: FieldError[] = [];
  const [categories, accounts] = await Promise.all([loadNames(db, "categories"), loadNames(db, "accounts")]);
  if (patch.date && patch.date > today) {
    errors.push({ field: "date", message: `date: 未来の日付(${patch.date})は登録できません。今日は ${today} です` });
  }
  if (patch.category && !categories.has(patch.category)) {
    errors.push({ field: "category", message: unknownName("category", "カテゴリ", patch.category, categories) });
  }
  if (patch.account && !accounts.has(patch.account)) {
    errors.push({ field: "account", message: unknownName("account", "口座", patch.account, accounts) });
  }
  if (errors.length > 0) return { ok: false, errors };

  // undefined は「変えない」、null は「空にする」
  const next: TransactionView = {
    ...current,
    date: patch.date ?? current.date,
    amount: patch.amount ?? current.amount,
    merchant: patch.merchant === undefined ? current.merchant : patch.merchant,
    category: patch.category === undefined ? current.category : patch.category,
    account: patch.account === undefined ? current.account : patch.account,
    memo: patch.memo === undefined ? current.memo : patch.memo,
    source: patch.source ?? current.source,
    tax_flag: patch.tax_flag === undefined ? current.tax_flag : patch.tax_flag,
  };
  next.status = next.merchant && next.category ? "ok" : "needs_review";
  const hash = await dedupHash(next.date, next.amount, next.merchant ?? undefined);

  await db
    .prepare(
      `UPDATE transactions
       SET date = ?, amount = ?, merchant = ?, category_id = ?, account_id = ?, memo = ?, source = ?, status = ?, dedup_hash = ?, updated_at = ?, tax_flag = ?
       WHERE id = ?`,
    )
    .bind(
      next.date,
      next.amount,
      next.merchant,
      next.category ? categories.get(next.category)! : null,
      next.account ? accounts.get(next.account)! : null,
      next.memo,
      next.source,
      next.status,
      hash,
      now.toISOString(),
      next.tax_flag,
      next.id,
    )
    .run();

  // 更新は止めない。同じ日・金額・店の別の取引があれば、警告として知らせる
  const { results: dups } = await db
    .prepare("SELECT id FROM transactions WHERE dedup_hash = ? AND id != ? ORDER BY created_at, id")
    .bind(hash, next.id)
    .all<{ id: string }>();
  const warnings = dups.map((d) => ({
    duplicate_of: d.id,
    message: `取引 ${d.id} と同じ日・金額・店です。重複登録の可能性があります。重複なら delete_transaction で片方を削除してください`,
  }));

  const message = `更新しました: ${label(next)}${warnings.length > 0 ? `。重複の疑いが${warnings.length}件あります` : ""}`;
  return { ok: true, transaction: next, warnings, message };
}

export async function deleteTransaction(db: D1Database, input: unknown): Promise<DeleteResult> {
  const parsed = deleteTransactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;

  const current = await db.prepare(VIEW_SELECT).bind(id).first<TransactionView>();
  if (!current) return { ok: false, errors: notFound(id) };

  // 写真(フェーズ5)が紐づく取引は、外部キーで落ちる前に、分かる文章で断る
  const photos = await db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE transaction_id = ?").bind(id).first<{ n: number }>();
  if (photos && photos.n > 0) {
    return {
      ok: false,
      errors: [{ field: "id", message: `id: 写真が${photos.n}枚紐づいているため削除できません(${label(current)})` }],
    };
  }

  // リンク(外部リンク)は軽いので、取引といっしょに消す
  await db.batch([db.prepare("DELETE FROM links WHERE transaction_id = ?").bind(id), db.prepare("DELETE FROM transactions WHERE id = ?").bind(id)]);
  return { ok: true, deleted: current, message: `削除しました: ${label(current)}` };
}
