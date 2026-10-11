import { todayJst } from "./dates";
import {
  addTransactionsEnvelopeSchema,
  listTransactionsSchema,
  transactionInputSchema,
  toFieldErrors,
  type FieldError,
  type TransactionInput,
} from "./schema";

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
}

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
          `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const { from, to, category, limit } = parsed.data;

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

  const { results } = await db
    .prepare(
      `SELECT t.id, t.date, t.amount, t.merchant, c.name AS category, a.name AS account, t.memo, t.source, t.status
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
