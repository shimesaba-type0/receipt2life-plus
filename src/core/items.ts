import type { FieldError, ItemInput } from "./schema";
import type { TaxFlag } from "./tax-flags";

// 明細(transaction_items)。1つの取引(レシート)の下の、品名・金額の行
// 取引の amount が支払総額の正で、明細がある取引は「明細の合計 = 取引の amount」を保つ(検証は schema.ts の itemsTotalMismatch)
// 行の実効カテゴリ・実効フラグは COALESCE(行の値, 取引の値)

export interface ItemView {
  id: string;
  // 並び順(0 始まり。レシートの上からの順)
  position: number;
  name: string;
  amount: number;
  // 行自身のカテゴリ(実効ではない)。null なら取引のカテゴリに従う
  category: string | null;
  // 行自身のフラグ(実効ではない)。null なら取引のフラグに従う
  tax_flag: TaxFlag | null;
  memo: string | null;
}

// D1: 1文あたりのバインド変数は100個まで。IN句は余裕をみて90個ずつ
const IN_CHUNK = 90;

const ITEM_COLUMNS = "i.id, i.position, i.name, i.amount, c.name AS category, i.tax_flag, i.memo";

// 取引の id ごとの明細(並び順)。明細が無い取引はマップに入らない
export async function loadItems(db: D1Database, transactionIds: readonly string[]): Promise<Map<string, ItemView[]>> {
  const out = new Map<string, ItemView[]>();
  const ids = [...new Set(transactionIds)];
  for (let k = 0; k < ids.length; k += IN_CHUNK) {
    const part = ids.slice(k, k + IN_CHUNK);
    const { results } = await db
      .prepare(
        `SELECT i.transaction_id, ${ITEM_COLUMNS}
         FROM transaction_items i LEFT JOIN categories c ON c.id = i.category_id
         WHERE i.transaction_id IN (${part.map(() => "?").join(",")})
         ORDER BY i.transaction_id, i.position, i.id`,
      )
      .bind(...part)
      .all<ItemView & { transaction_id: string }>();
    for (const { transaction_id: txId, ...item } of results) {
      const list = out.get(txId) ?? [];
      list.push(item);
      out.set(txId, list);
    }
  }
  return out;
}

// 取引の行に明細(items)を付ける。明細なしは空配列
export async function withItems<T extends { id: string }>(db: D1Database, rows: readonly T[]): Promise<(T & { items: ItemView[] })[]> {
  if (rows.length === 0) return [];
  const items = await loadItems(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, items: items.get(r.id) ?? [] }));
}

// ---- 支出の行(集計の土台) ----

/**
 * 「支出の行」の副問い合わせ。明細がある取引は各明細行、明細がない取引は取引そのものを1行として返す。
 * 列: transaction_id, item_id(取引そのものの行は NULL), date, merchant, amount, category_id(実効), tax_flag(実効)
 * where は transactions を t として書いた条件(例: "t.date >= ?")。params は2回ずつ使うので、bind には lines.params を渡す。
 * 明細の合計 = 取引の amount なので、行の amount の総和は、取引の amount の総和と一致する。
 */
export function spendLines(where: string[], params: readonly (string | number)[]): { sql: string; params: (string | number)[] } {
  const cond = where.join(" AND ");
  const sql = `(SELECT t.id AS transaction_id, NULL AS item_id, t.date AS date, t.merchant AS merchant, t.amount AS amount,
            t.category_id AS category_id, t.tax_flag AS tax_flag
     FROM transactions t
     WHERE NOT EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id)${cond ? ` AND ${cond}` : ""}
     UNION ALL
     SELECT t.id, i.id, t.date, t.merchant, i.amount, COALESCE(i.category_id, t.category_id), COALESCE(i.tax_flag, t.tax_flag)
     FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id${cond ? ` WHERE ${cond}` : ""})`;
  return { sql, params: [...params, ...params] };
}

/**
 * 取引 t の支出の行のどれかが条件に当てはまるか(list_transactions の絞り込み用)。
 * column は "category_id" か "tax_flag"。test は実効値の式を受け取って条件を返す(例: (v) => `${v} = ?`)。
 * test が ? を含むなら、bind は2回ぶん渡す。
 */
export function anyLineMatches(column: "category_id" | "tax_flag", test: (value: string) => string): string {
  return `((NOT EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id) AND ${test(`t.${column}`)})
    OR EXISTS (SELECT 1 FROM transaction_items x WHERE x.transaction_id = t.id AND ${test(`COALESCE(x.${column}, t.${column})`)}))`;
}

// ---- 検証・保存 ----

// 店名が空、または実効カテゴリが無い行が1つでもあれば、後で見直す対象にする
export function needsReview(merchant: string | null | undefined, category: string | null | undefined, items: readonly { category?: string | null }[]): boolean {
  if (!merchant) return true;
  if (category) return false;
  return items.length === 0 || items.some((i) => !i.category);
}

// 明細のカテゴリ名を検証する。未知の名前は items.<行>.category のエラー
export function checkItemCategories(
  items: readonly ItemInput[],
  categories: Map<string, string>,
  index?: number,
): FieldError[] {
  const errors: FieldError[] = [];
  items.forEach((item, k) => {
    if (item.category && !categories.has(item.category)) {
      errors.push({
        ...(index !== undefined ? { index } : {}),
        field: `items.${k}.category`,
        message: `items.${k}.category: 「${item.category}」というカテゴリはありません。選べる値: ${[...categories.keys()].join("、")}`,
      });
    }
  });
  return errors;
}

export interface StoredItem {
  view: ItemView;
  categoryId: string | null;
}

// 入力の行を、保存する形(id と並び順つき)にする。position は配列の順(0 始まり)
export function toStoredItems(items: readonly ItemInput[], categories: Map<string, string>): StoredItem[] {
  return items.map((item, position) => ({
    view: {
      id: crypto.randomUUID(),
      position,
      name: item.name,
      amount: item.amount,
      category: item.category ?? null,
      tax_flag: item.tax_flag ?? null,
      memo: item.memo ?? null,
    },
    categoryId: item.category ? categories.get(item.category)! : null,
  }));
}

export function insertItemStatements(db: D1Database, transactionId: string, items: readonly StoredItem[], createdAt: string): D1PreparedStatement[] {
  return items.map(({ view, categoryId }) =>
    db
      .prepare(
        `INSERT INTO transaction_items (id, transaction_id, position, name, amount, category_id, tax_flag, memo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(view.id, transactionId, view.position, view.name, view.amount, categoryId, view.tax_flag, view.memo, createdAt),
  );
}
