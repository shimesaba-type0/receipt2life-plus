import { todayJst } from "./dates";
import {
  anyLineMatches,
  checkItemCategories,
  insertItemStatements,
  needsReview,
  toStoredItems,
  withItems,
  type ItemView,
  type StoredItem,
} from "./items";
import type { LinkView } from "./links";
import { toPhotoView, type PhotoView } from "./photos";
import { detailsOf, phoneDigits, RECEIPT_DETAIL_KEYS, type ReceiptDetails } from "./receipt-details";
import {
  addTransactionsEnvelopeSchema,
  itemsTotalMismatch,
  listTransactionsSchema,
  transactionInputSchema,
  toFieldErrors,
  type FieldError,
  type ItemInput,
  type TransactionInput,
} from "./schema";
import { ANY_TAX_FLAG, type TaxFlag } from "./tax-flags";
import { insertTaxLineStatements, taxLineWarnings, toStoredTaxLines, type TaxLineInput, type TaxLineView, type TaxWarning } from "./tax-lines";
import { deleteTransactionSchema, updateTransactionSchema } from "./transaction-edit-schema";

export type { ItemView } from "./items";
export type { TaxLineView, TaxWarning } from "./tax-lines";

export interface CoreOptions {
  now?: Date;
}

// 取引の行(明細を含まない)。TX_VIEW_COLUMNS で読んだもの
export interface TransactionRow extends ReceiptDetails {
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

// 取引の表現。items は明細(並び順。明細なしは空配列)、tax_lines は税の内訳(税率の高い順。なしは空配列)
export interface TransactionView extends TransactionRow {
  items: ItemView[];
  tax_lines: TaxLineView[];
}

// 登録の結果の1件。カテゴリを同じ店の直近の支出から引き継いだときだけ applied_default_category にその名前が入る
export type RegisteredTransaction = TransactionView & { applied_default_category?: string };

// 取引の表示用の列(TransactionRow と同じ並び)。transactions を t、カテゴリを c、口座を a で JOIN して使う
export const TX_VIEW_COLUMNS = "t.id, t.date, t.amount, t.merchant, c.name AS category, a.name AS account, t.memo, t.source, t.status, t.tax_flag, t.paid_time, t.merchant_phone, t.merchant_address, t.invoice_number, t.clerk_name, t.receipt_no, t.register_no, t.store_code";

export interface DuplicateInfo {
  index: number;
  existing_id?: string;
  duplicate_of_index?: number;
}

export type AddResult =
  // tax_warnings: 税の内訳の合計が金額と合わないなどの注意(エラーにはしない。index は登録の配列の位置)
  | { ok: true; registered: RegisteredTransaction[]; skipped_duplicates: DuplicateInfo[]; tax_warnings: TaxWarning[]; message: string }
  | { ok: false; errors: FieldError[] };

export type ListResult =
  // include_items: false のときは items と tax_lines を省く
  | { ok: true; transactions: (TransactionRow & { items?: ItemView[]; tax_lines?: TaxLineView[] })[]; count: number }
  | { ok: false; errors: FieldError[] };

interface NamedRow {
  id: string;
  name: string;
}

// 店名の正規化。全角半角・大文字小文字・空白の違いを吸収する(重複判定とカテゴリの引き継ぎで使う)
export function normalizeMerchant(merchant: string | null | undefined): string {
  return (merchant ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

// 日付+金額+正規化した店名のSHA-256。決済時刻(paid_time)がある取引は、時刻も含める(同じ日に同じ店で同額の別の買い物を、重複にしないため)。
// 時刻がなければ従来どおり(日付|金額|店名)で、既存の取引のハッシュは変わらない
export async function dedupHash(date: string, amount: number, merchant: string | null | undefined, paidTime?: string | null): Promise<string> {
  const base = `${date}|${amount}|${normalizeMerchant(merchant)}`;
  const data = new TextEncoder().encode(paidTime ? `${base}|${paidTime}` : base);
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

// 同じ店のカテゴリを引き継ぐ対象か: 店名があり、取引のカテゴリが無く、カテゴリの無い行(明細なしなら取引そのもの)があるとき
function wantsDefaultCategory(item: TransactionInput): boolean {
  if (!item.merchant || item.category) return false;
  const items = item.items ?? [];
  return items.length === 0 || items.some((i) => !i.category);
}

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
    errors.push(...checkItemCategories(item.items ?? [], categories, index));
  });
  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => (a.index ?? -1) - (b.index ?? -1)) };
  // ここまで来たら全件が正しいので、valid の並びは元の配列と同じ(indexが一致する)
  const items = valid.map((v) => v.item);

  const prepared = await Promise.all(
    items.map(async (item) => ({ item, date: item.date ?? today, hash: await dedupHash(item.date ?? today, item.amount, item.merchant, item.paid_time) })),
  );

  const existing = new Map<string, string>();
  const hashes = [...new Set(prepared.map((p) => p.hash))];
  const { results } = await db
    .prepare(`SELECT id, dedup_hash FROM transactions WHERE dedup_hash IN (${hashes.map(() => "?").join(",")}) ORDER BY created_at`)
    .bind(...hashes)
    .all<{ id: string; dedup_hash: string }>();
  for (const row of results) if (!existing.has(row.dedup_hash)) existing.set(row.dedup_hash, row.id);

  // 同じ店のカテゴリの引き継ぎ先は、必要なときだけ読む(既存の取引だけを見る。同じ呼び出しの他の取引は見ない)
  const defaults = prepared.some((p) => wantsDefaultCategory(p.item)) ? await latestCategoryByMerchant(db) : new Map<string, string>();

  const skipped: DuplicateInfo[] = [];
  const registered: RegisteredTransaction[] = [];
  const statements: D1PreparedStatement[] = [];
  const seenInBatch = new Map<string, number>();
  const timestamp = now.toISOString();
  const taxWarnings: TaxWarning[] = [];

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
    // AIが明示したカテゴリは上書きしない。引き継ぐのは、カテゴリが省略されたときだけ
    const applied = wantsDefaultCategory(item) ? defaults.get(normalizeMerchant(item.merchant)) : undefined;
    const category = item.category ?? applied ?? null;
    const stored = toStoredItems(item.items ?? [], categories);
    const taxLines = toStoredTaxLines(item.tax_lines ?? []);
    taxWarnings.push(...taxLineWarnings(item.amount, taxLines, index));
    const status = needsReview(item.merchant, category, stored.map((s) => s.view)) ? "needs_review" : "ok";
    statements.push(
      db
        .prepare(
          `INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag,
                                      paid_time, merchant_phone, merchant_address, invoice_number, clerk_name, receipt_no, register_no, store_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          date,
          item.amount,
          item.merchant ?? null,
          category ? categories.get(category)! : null,
          item.account ? accounts.get(item.account)! : null,
          item.memo ?? null,
          item.source,
          status,
          hash,
          timestamp,
          timestamp,
          item.tax_flag ?? null,
          ...RECEIPT_DETAIL_KEYS.map((k) => item[k] ?? null),
        ),
      ...insertItemStatements(db, id, stored, timestamp),
      ...insertTaxLineStatements(db, id, taxLines, timestamp),
    );
    registered.push({
      id,
      date,
      amount: item.amount,
      merchant: item.merchant ?? null,
      category,
      account: item.account ?? null,
      memo: item.memo ?? null,
      source: item.source,
      status,
      tax_flag: item.tax_flag ?? null,
      ...detailsOf(item),
      items: stored.map((s) => s.view),
      tax_lines: taxLines,
      ...(applied ? { applied_default_category: applied } : {}),
    });
  });

  // 全件成功か全件ロールバック(D1のbatchはトランザクションとして実行される)。明細も同じ batch に入れる
  if (statements.length > 0) await db.batch(statements);

  const message = buildMessage(registered, skipped, prepared) + (taxWarnings.length > 0 ? `。税の内訳に注意が${taxWarnings.length}件あります(tax_warnings)` : "");
  return { ok: true, registered, skipped_duplicates: skipped, tax_warnings: taxWarnings, message };
}

/**
 * 正規化した店名 → その店の直近の取引(日付、登録日時の新しい順)のカテゴリ名。カテゴリが付いた取引だけを見る。
 * 表記ゆれ(全角半角・大文字小文字・空白)は normalizeMerchant で吸収する(SQLでは正規化できないので、店名の表記ごとの直近を読んで寄せる)。
 */
async function latestCategoryByMerchant(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT r.merchant, c.name AS category, r.date, r.created_at, r.id
       FROM (SELECT merchant, category_id, date, created_at, id,
               ROW_NUMBER() OVER (PARTITION BY merchant ORDER BY date DESC, created_at DESC, id DESC) AS rn
             FROM transactions WHERE merchant IS NOT NULL AND category_id IS NOT NULL) r
       JOIN categories c ON c.id = r.category_id
       WHERE r.rn = 1`,
    )
    .all<{ merchant: string; category: string; date: string; created_at: string; id: string }>();
  const best = new Map<string, { category: string; order: string }>();
  for (const r of results) {
    const key = normalizeMerchant(r.merchant);
    if (!key) continue;
    const order = `${r.date}|${r.created_at}|${r.id}`;
    const current = best.get(key);
    if (!current || order > current.order) best.set(key, { category: r.category, order });
  }
  return new Map([...best].map(([k, v]) => [k, v.category]));
}

function buildMessage(registered: RegisteredTransaction[], skipped: DuplicateInfo[], prepared: { item: TransactionInput; date: string }[]): string {
  const parts: string[] = [];
  parts.push(registered.length > 0 ? `${registered.length}件登録しました: ${registered.map(label).join(" / ")}` : "登録した取引はありません");
  if (skipped.length > 0) {
    const names = skipped.map((s) => label({ merchant: prepared[s.index]?.item.merchant ?? null, amount: prepared[s.index]?.item.amount ?? 0 }));
    parts.push(`重複の疑いで${skipped.length}件は登録しませんでした(${names.join(" / ")})。別の買い物なら allow_duplicate:true で再送してください`);
  }
  const inherited = registered.filter((r) => r.applied_default_category);
  if (inherited.length > 0) {
    const list = inherited.map((r) => `${r.merchant ?? ""} → ${r.applied_default_category ?? ""}`).join(" / ");
    parts.push(`${inherited.length}件はカテゴリの指定が無かったため、同じ店の直近の支出のカテゴリを使いました(${list})。違っていれば update_transaction で直してください`);
  }
  const review = registered.filter((r) => r.status === "needs_review").length;
  if (review > 0) parts.push(`${review}件は店名またはカテゴリが空のため needs_review にしました`);
  return parts.join("。");
}

// LIKE のワイルドカード(% と _)とエスケープ文字(\)を文字として扱う
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

const KEYWORD_COLUMNS = ["t.merchant", "t.merchant_phone", "t.merchant_address", "t.clerk_name", "t.memo", "t.receipt_no", "t.invoice_number"] as const;
// 保存済みの電話番号から数字以外(ハイフン・括弧・プラス・空白)を除く式
const PHONE_DIGITS_SQL = `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(t.merchant_phone, '-', ''), ' ', ''), '(', ''), ')', ''), '+', '')`;

// keyword の条件: 店名・電話番号・住所・担当者名・メモ・レシート番号・登録番号のどれかに部分一致。
// 電話番号らしいキーワード(数字・ハイフン・括弧・プラス・空白だけ)は、数字だけにそろえた比較でも当てる
export function keywordCondition(keyword: string): { sql: string; params: string[] } {
  const pattern = `%${escapeLike(keyword)}%`;
  const parts = KEYWORD_COLUMNS.map((c) => `${c} LIKE ? ESCAPE '\\'`);
  const params = KEYWORD_COLUMNS.map(() => pattern);
  const digits = phoneDigits(keyword);
  if (digits !== "" && /^[\d\-()+\s]+$/.test(keyword.normalize("NFKC"))) {
    parts.push(`${PHONE_DIGITS_SQL} LIKE ?`);
    params.push(`%${digits}%`);
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}

export async function listTransactions(db: D1Database, input: unknown): Promise<ListResult> {
  const parsed = listTransactionsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { from, to, category, tax_flag: taxFlag, keyword, limit, include_items: includeItems } = parsed.data;

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
  // カテゴリとフラグは、支出の行(明細があれば各行の実効値、無ければ取引そのもの)のどれかが当てはまれば含める
  if (category) {
    const categories = await loadNames(db, "categories");
    const id = categories.get(category);
    if (!id) return { ok: false, errors: [{ field: "category", message: unknownName("category", "カテゴリ", category, categories) }] };
    where.push(anyLineMatches("category_id", (v) => `${v} = ?`));
    params.push(id, id);
  }
  if (taxFlag === ANY_TAX_FLAG) {
    where.push(anyLineMatches("tax_flag", (v) => `${v} IS NOT NULL`));
  } else if (taxFlag) {
    where.push(anyLineMatches("tax_flag", (v) => `${v} = ?`));
    params.push(taxFlag, taxFlag);
  }

  if (keyword) {
    const search = keywordCondition(keyword);
    where.push(search.sql);
    params.push(...search.params);
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
    .all<TransactionRow>();

  const transactions = includeItems ? await withItems(db, results) : results;
  return { ok: true, transactions, count: results.length };
}

export interface DuplicateWarning {
  duplicate_of: string;
  message: string;
}

export type UpdateResult =
  // tax_warnings: 税の内訳の合計が金額と合わないなどの注意(エラーにはしない)
  | { ok: true; transaction: TransactionView; warnings: DuplicateWarning[]; tax_warnings: TaxWarning[]; message: string }
  | { ok: false; errors: FieldError[] };

// 削除したもの。transaction は削除前の内容(明細つき)、items / photos / links はいっしょに消した件数
export interface DeletedTransaction {
  transaction: TransactionView;
  items: number;
  photos: number;
  links: number;
}

export type DeleteResult = { ok: true; deleted: DeletedTransaction; message: string } | { ok: false; errors: FieldError[] };

export interface TransactionDetail {
  ok: true;
  transaction: TransactionView;
  // この取引に紐づく写真・リンク(transaction_id が一致するもの)
  photos: PhotoView[];
  links: LinkView[];
  counts: { items: number; photos: number; links: number };
}

export type TransactionDetailResult = TransactionDetail | { ok: false; errors: FieldError[] };

const VIEW_SELECT = `SELECT ${TX_VIEW_COLUMNS}
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ?`;

const notFound = (id: string): FieldError[] => [
  { field: "id", message: `id: 「${id.slice(0, 64)}」という取引はありません。list_transactions で id を確認してください` },
];

async function findTransaction(db: D1Database, id: string): Promise<TransactionView | null> {
  const row = await db.prepare(VIEW_SELECT).bind(id).first<TransactionRow>();
  if (!row) return null;
  const [view] = await withItems(db, [row]);
  return view ?? null;
}

// 1件の取引と、明細・写真・リンク(取引の詳細画面用)
export async function getTransaction(db: D1Database, id: string): Promise<TransactionDetailResult> {
  if (id.length === 0 || id.length > 100) return { ok: false, errors: notFound(id) };
  const transaction = await findTransaction(db, id);
  if (!transaction) return { ok: false, errors: notFound(id) };
  const [photos, links] = await Promise.all([
    db
      .prepare("SELECT id, date, transaction_id, event_id, caption, created_at FROM attachments WHERE transaction_id = ? ORDER BY created_at, id")
      .bind(id)
      .all<Omit<PhotoView, "url">>(),
    db
      .prepare("SELECT id, url, kind, title, description, date, transaction_id, event_id, created_at FROM links WHERE transaction_id = ? ORDER BY created_at, id")
      .bind(id)
      .all<LinkView>(),
  ]);
  return {
    ok: true,
    transaction,
    photos: photos.results.map(toPhotoView),
    links: links.results,
    counts: { items: transaction.items.length, photos: photos.results.length, links: links.results.length },
  };
}

export async function updateTransaction(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<UpdateResult> {
  const parsed = updateTransactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const patch = parsed.data;

  const current = await findTransaction(db, patch.id);
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
  // items は全置換。null と省略は「変えない」
  const replaceItems: ItemInput[] | null = patch.items ?? null;
  if (replaceItems) errors.push(...checkItemCategories(replaceItems, categories));
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
    paid_time: patch.paid_time === undefined ? current.paid_time : patch.paid_time,
    merchant_phone: patch.merchant_phone === undefined ? current.merchant_phone : patch.merchant_phone,
    merchant_address: patch.merchant_address === undefined ? current.merchant_address : patch.merchant_address,
    invoice_number: patch.invoice_number === undefined ? current.invoice_number : patch.invoice_number,
    clerk_name: patch.clerk_name === undefined ? current.clerk_name : patch.clerk_name,
    receipt_no: patch.receipt_no === undefined ? current.receipt_no : patch.receipt_no,
    register_no: patch.register_no === undefined ? current.register_no : patch.register_no,
    store_code: patch.store_code === undefined ? current.store_code : patch.store_code,
  };
  const stored: StoredItem[] | null = replaceItems ? toStoredItems(replaceItems, categories) : null;
  next.items = stored ? stored.map((s) => s.view) : current.items;
  // tax_lines も全置換。null と省略は「変えない」
  const replaceTaxLines: TaxLineInput[] | null = patch.tax_lines ?? null;
  const storedTaxLines: TaxLineView[] | null = replaceTaxLines ? toStoredTaxLines(replaceTaxLines) : null;
  next.tax_lines = storedTaxLines ?? current.tax_lines;

  // 明細がある取引は、明細の合計 = 金額を保つ(金額だけ・カテゴリだけの変更でも確かめる)
  const mismatch = itemsTotalMismatch(next.amount, next.items);
  if (mismatch) {
    const field = stored ? "items" : "amount";
    const hint = stored ? "" : "(今の明細の合計と合いません。items もいっしょに直すか、items: [] で明細を消してください)";
    return { ok: false, errors: [{ field, message: `${field}: ${mismatch}${hint}` }] };
  }

  next.status = needsReview(next.merchant, next.category, next.items) ? "needs_review" : "ok";
  const hash = await dedupHash(next.date, next.amount, next.merchant, next.paid_time);
  const timestamp = now.toISOString();

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE transactions
         SET date = ?, amount = ?, merchant = ?, category_id = ?, account_id = ?, memo = ?, source = ?, status = ?, dedup_hash = ?, updated_at = ?, tax_flag = ?,
             paid_time = ?, merchant_phone = ?, merchant_address = ?, invoice_number = ?, clerk_name = ?, receipt_no = ?, register_no = ?, store_code = ?
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
        timestamp,
        next.tax_flag,
        ...RECEIPT_DETAIL_KEYS.map((k) => next[k]),
        next.id,
      ),
  ];
  if (stored) {
    statements.push(db.prepare("DELETE FROM transaction_items WHERE transaction_id = ?").bind(next.id), ...insertItemStatements(db, next.id, stored, timestamp));
  }
  if (storedTaxLines) {
    statements.push(db.prepare("DELETE FROM transaction_tax_lines WHERE transaction_id = ?").bind(next.id), ...insertTaxLineStatements(db, next.id, storedTaxLines, timestamp));
  }
  // 取引と明細の置き換えは、1回の batch(全部成功か全部ロールバック)
  await db.batch(statements);

  // 更新は止めない。同じ日・金額・店の別の取引があれば、警告として知らせる
  const { results: dups } = await db
    .prepare("SELECT id FROM transactions WHERE dedup_hash = ? AND id != ? ORDER BY created_at, id")
    .bind(hash, next.id)
    .all<{ id: string }>();
  const warnings = dups.map((d) => ({
    duplicate_of: d.id,
    message: `取引 ${d.id} と同じ日・金額・店です。重複登録の可能性があります。重複なら delete_transaction で片方を削除してください`,
  }));

  const taxWarnings = taxLineWarnings(next.amount, next.tax_lines);
  const itemNote = stored ? `(明細${stored.length}行${stored.length === 0 ? "。明細を消しました" : "に置き換えました"})` : "";
  const taxNote = storedTaxLines ? `(税の内訳${storedTaxLines.length === 0 ? "を消しました" : `${storedTaxLines.length}行に置き換えました`})` : "";
  const message = `更新しました: ${label(next)}${itemNote}${taxNote}${warnings.length > 0 ? `。重複の疑いが${warnings.length}件あります` : ""}${taxWarnings.length > 0 ? `。税の内訳に注意が${taxWarnings.length}件あります(tax_warnings)` : ""}`;
  return { ok: true, transaction: next, warnings, tax_warnings: taxWarnings, message };
}

export interface DeleteTransactionOptions {
  // delete_photos のときに写真の実体(R2)を消す先
  bucket?: R2Bucket;
}

export async function deleteTransaction(db: D1Database, input: unknown, options: DeleteTransactionOptions = {}): Promise<DeleteResult> {
  const parsed = deleteTransactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, delete_photos: deletePhotos } = parsed.data;

  const current = await findTransaction(db, id);
  if (!current) return { ok: false, errors: notFound(id) };

  const [photoRows, linkCount] = await Promise.all([
    db.prepare("SELECT id, r2_key FROM attachments WHERE transaction_id = ? ORDER BY id").bind(id).all<{ id: string; r2_key: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM links WHERE transaction_id = ?").bind(id).first<{ n: number }>(),
  ]);
  const photos = photoRows.results;
  // 写真が紐づく取引は、指定が無ければ外部キーで落ちる前に、分かる文章で断る
  if (photos.length > 0 && !deletePhotos) {
    return {
      ok: false,
      errors: [
        {
          field: "id",
          message: `id: 写真${photos.length}枚が紐づいています。delete_photos で写真もいっしょに削除できます(${label(current)} は削除していません)`,
        },
      ],
    };
  }
  if (photos.length > 0) {
    if (!options.bucket) return { ok: false, errors: [{ field: "delete_photos", message: "delete_photos: 写真の保存先に接続できないため、写真を削除できません" }] };
    // 写真の実体(R2)が先、行が後。途中で失敗しても、再実行すれば残りが消える(写真の削除と同じ順)
    await options.bucket.delete(photos.map((p) => p.r2_key));
  }

  // 写真の行 → リンク → 明細 → 取引の順(外部キーの子から)。1回の batch
  await db.batch([
    db.prepare("DELETE FROM attachments WHERE transaction_id = ?").bind(id),
    db.prepare("DELETE FROM links WHERE transaction_id = ?").bind(id),
    db.prepare("DELETE FROM transaction_items WHERE transaction_id = ?").bind(id),
    // 税の内訳は ON DELETE CASCADE でも消えるが、明細と同じく明示して消す
    db.prepare("DELETE FROM transaction_tax_lines WHERE transaction_id = ?").bind(id),
    db.prepare("DELETE FROM transactions WHERE id = ?").bind(id),
  ]);
  const deleted: DeletedTransaction = { transaction: current, items: current.items.length, photos: photos.length, links: linkCount?.n ?? 0 };
  const extras = [
    ...(deleted.items > 0 ? [`明細${deleted.items}行`] : []),
    ...(deleted.photos > 0 ? [`写真${deleted.photos}枚`] : []),
    ...(deleted.links > 0 ? [`リンク${deleted.links}件`] : []),
  ];
  return { ok: true, deleted, message: `削除しました: ${label(current)}${extras.length > 0 ? `(${extras.join("、")}もいっしょに削除)` : ""}` };
}
