import { computeUnitPrice, type ContentUnit, type UnitPrice } from "./item-products";
import type { FieldError, ItemInput } from "./schema";
import type { TaxFlag } from "./tax-flags";
import { blankToNull, loadTaxLines, type TaxLineView } from "./tax-lines";

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
  // 消費税の税率(%。印字どおり。不明は null)と、印字どおりの記号(「※」など。なしは null)。tax_flag とは別物
  tax_rate: number | null;
  tax_label: string | null;
  // 商品の情報(任意)。product=統一した商品名、quantity=買った数、content_amount / content_unit=1つあたりの内容量(g・ml・個)
  product: string | null;
  quantity: number | null;
  content_amount: number | null;
  content_unit: ContentUnit | null;
  // JANコード(商品のバーコード。8桁か13桁の数字。分かるときだけ)
  jan_code: string | null;
  // 単価(1g・1ml・1個あたりの円)。内容量が無い行・値引きの行は null。保存せず、計算して返す
  unit_price: UnitPrice | null;
}

// D1: 1文あたりのバインド変数は100個まで。IN句は余裕をみて90個ずつ
const IN_CHUNK = 90;

const ITEM_COLUMNS = "i.id, i.position, i.name, i.amount, c.name AS category, i.tax_flag, i.memo, i.tax_rate, i.tax_label, i.product, i.quantity, i.content_amount, i.content_unit, i.jan_code";

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
      .all<Omit<ItemView, "unit_price"> & { transaction_id: string }>();
    for (const { transaction_id: txId, ...row } of results) {
      const list = out.get(txId) ?? [];
      list.push({ ...row, unit_price: computeUnitPrice(row) });
      out.set(txId, list);
    }
  }
  return out;
}

// 取引の行に明細(items)と税の内訳(tax_lines)を付ける。どちらも、無ければ空配列
export async function withItems<T extends { id: string }>(db: D1Database, rows: readonly T[]): Promise<(T & { items: ItemView[]; tax_lines: TaxLineView[] })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [items, taxLines] = await Promise.all([loadItems(db, ids), loadTaxLines(db, ids)]);
  return rows.map((r) => ({ ...r, items: items.get(r.id) ?? [], tax_lines: taxLines.get(r.id) ?? [] }));
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
      tax_rate: item.tax_rate ?? null,
      tax_label: blankToNull(item.tax_label),
      product: blankToNull(item.product),
      quantity: item.quantity ?? null,
      content_amount: item.content_amount ?? null,
      content_unit: item.content_unit ?? null,
      jan_code: item.jan_code ?? null,
      unit_price: computeUnitPrice({ amount: item.amount, quantity: item.quantity, content_amount: item.content_amount, content_unit: item.content_unit }),
    },
    categoryId: item.category ? categories.get(item.category)! : null,
  }));
}

export function insertItemStatements(db: D1Database, transactionId: string, items: readonly StoredItem[], createdAt: string): D1PreparedStatement[] {
  return items.map(({ view, categoryId }) =>
    db
      .prepare(
        `INSERT INTO transaction_items (id, transaction_id, position, name, amount, category_id, tax_flag, memo, created_at, tax_rate, tax_label, product, quantity, content_amount, content_unit, jan_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(view.id, transactionId, view.position, view.name, view.amount, categoryId, view.tax_flag, view.memo, createdAt, view.tax_rate, view.tax_label, view.product, view.quantity, view.content_amount, view.content_unit, view.jan_code),
  );
}
