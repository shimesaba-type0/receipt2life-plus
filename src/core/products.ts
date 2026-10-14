import { z } from "zod";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import { computeUnitPrice, type ContentUnit, type UnitPrice } from "./item-products";
import { normalizeForSearch } from "./search";

// 商品ごとの集計。「今月、牛乳を何本買ったか」「卵の単価の推移」。読み取り専用。
// 商品のキーは、明細の product(統一した商品名)で、無ければ品名(name)。JANコードがある行は、JANが同じなら表記が違っても同じ商品にまとめる
// (JANの無い行も、その品名の行に1種類のJANだけが付いていれば、そのJANの商品に入れる)。値引きの行(金額がマイナス)は数えない。
// 明細のある取引だけが対象(明細のない取引には、商品の名前がない)。件数は個人の記録の規模なので、期間で絞った行を読んで JS でまとめる

export const DEFAULT_PRODUCT_LIMIT = 50;
export const MAX_PRODUCT_LIMIT = 200;
export const MAX_HISTORY_PURCHASES = 100;

const rangeShape = {
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)。省略すると全期間"),
  to: isoDate.optional().describe("この日まで(YYYY-MM-DD)"),
};

export const listProductsSchema = z.strictObject({
  ...rangeShape,
  q: z.string().trim().max(100).optional().describe("商品名の絞り込み(部分一致。全角半角・かなカナ・大文字小文字は区別しない)。JANコード(数字)も当たる"),
  limit: z
    .number({ error: `limit は1〜${MAX_PRODUCT_LIMIT}の整数で指定してください` })
    .int()
    .min(1, `limit は1〜${MAX_PRODUCT_LIMIT}の整数で指定してください`)
    .max(MAX_PRODUCT_LIMIT, `limit は${MAX_PRODUCT_LIMIT}以下にしてください`)
    .default(DEFAULT_PRODUCT_LIMIT)
    .describe(`最大件数(既定${DEFAULT_PRODUCT_LIMIT}、最大${MAX_PRODUCT_LIMIT})。金額の大きい順`),
});

export const productHistorySchema = z.strictObject({
  product: z.string().trim().min(1, "product は必須です").max(100).describe("商品名(統一した商品名 product か、品名。全角半角・かなカナ・大文字小文字は区別しない)、またはJANコード(8桁か13桁の数字)"),
  ...rangeShape,
});

export interface ProductRow {
  // 商品名(商品のキー)
  product: string;
  // 買った行の数(レシートの行)
  lines: number;
  // 買った数の合計(quantity。省略した行は1)
  quantity: number;
  // 金額の合計(円)
  amount: number;
  // 最後に買った日
  last_date: string;
  // JANコード(まとめた行のうち、新しいものに付いていたもの。なしは null)
  jan_code: string | null;
  // 単価がわかる行があるか(内容量が入っている)
  has_unit_price: boolean;
}

export type ListProductsResult =
  | { ok: true; count: number; total: number; products: ProductRow[]; message: string }
  | { ok: false; errors: FieldError[] };

export interface MonthRow {
  // YYYY-MM
  month: string;
  lines: number;
  quantity: number;
  amount: number;
  // その月の単価(内容量がわかる行の、金額の合計÷内容量の合計)。わからなければ null
  unit_price: UnitPrice | null;
}

export interface PurchaseRow {
  date: string;
  transaction_id: string;
  merchant: string | null;
  // レシートの品名
  name: string;
  quantity: number;
  amount: number;
  content_amount: number | null;
  content_unit: ContentUnit | null;
  unit_price: UnitPrice | null;
}

export interface UnitPriceSummary {
  unit: ContentUnit;
  // いちばん新しい買い物の単価
  latest: { per_unit: number; date: string };
  // 期間でいちばん安かった買い物
  cheapest: { per_unit: number; date: string; merchant: string | null };
  // 期間の平均(金額の合計÷内容量の合計)
  average: number;
}

export type ProductHistoryResult =
  | {
      ok: true;
      product: string;
      // この商品の明細に付いていたJANコード(なしは空)
      jan_codes: string[];
      lines: number;
      quantity: number;
      amount: number;
      // 古い順(データのある月だけ)
      months: MonthRow[];
      unit_price: UnitPriceSummary | null;
      // 新しい順。最大 MAX_HISTORY_PURCHASES 件
      purchases: PurchaseRow[];
      message: string;
    }
  | { ok: false; errors: FieldError[] };

interface LineRow {
  key: string;
  date: string;
  transaction_id: string;
  merchant: string | null;
  name: string;
  amount: number;
  quantity: number | null;
  content_amount: number | null;
  content_unit: ContentUnit | null;
  jan_code: string | null;
}

async function loadLines(db: D1Database, from?: string, to?: string): Promise<LineRow[]> {
  const where = ["i.amount > 0"];
  const params: string[] = [];
  if (from) {
    where.push("t.date >= ?");
    params.push(from);
  }
  if (to) {
    where.push("t.date <= ?");
    params.push(to);
  }
  const { results } = await db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(i.product), ''), i.name) AS key, t.date, t.id AS transaction_id, t.merchant, i.name, i.amount, i.quantity, i.content_amount, i.content_unit, i.jan_code
       FROM transaction_items i JOIN transactions t ON t.id = i.transaction_id
       WHERE ${where.join(" AND ")} ORDER BY t.date DESC, t.created_at DESC, i.position`,
    )
    .bind(...params)
    .all<LineRow>();
  return results;
}

const qty = (l: Pick<LineRow, "quantity">) => l.quantity ?? 1;
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

// 内容量がわかる行の単価。いちばん多い単位にそろえて、金額の合計÷内容量の合計
function weightedUnitPrice(lines: readonly LineRow[]): UnitPrice | null {
  const priced = lines.filter((l) => computeUnitPrice(l) !== null);
  if (priced.length === 0) return null;
  const counts = new Map<ContentUnit, number>();
  for (const l of priced) counts.set(l.content_unit!, (counts.get(l.content_unit!) ?? 0) + 1);
  const unit = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  const same = priced.filter((l) => l.content_unit === unit);
  const amount = same.reduce((s, l) => s + l.amount, 0);
  const content = same.reduce((s, l) => s + qty(l) * l.content_amount!, 0);
  return content > 0 ? { per_unit: amount / content, unit } : null;
}

interface Group {
  // 表示する商品名(いちばん新しい行の商品名)
  product: string;
  jan: string | null;
  // 含まれる商品名(正規化したもの)
  names: Set<string>;
  lines: LineRow[];
}

// 行を商品ごとにまとめる。JANがあればJAN、無ければ(その品名にJANが1種類だけなら、そのJAN、それ以外は)正規化した商品名で
function groupLines(lines: readonly LineRow[]): Group[] {
  const janByName = new Map<string, Set<string>>();
  for (const l of lines) {
    if (l.jan_code) {
      const k = normalizeForSearch(l.key);
      janByName.set(k, (janByName.get(k) ?? new Set()).add(l.jan_code));
    }
  }
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const name = normalizeForSearch(l.key);
    const only = janByName.get(name);
    const jan = l.jan_code ?? (only && only.size === 1 ? [...only][0]! : null);
    const id = jan ? `jan:${jan}` : `name:${name}`;
    const g = groups.get(id) ?? { product: l.key, jan, names: new Set<string>(), lines: [] };
    g.names.add(name);
    g.lines.push(l);
    groups.set(id, g);
  }
  return [...groups.values()];
}

const isJanQuery = (s: string) => /^\d{8}$|^\d{13}$/.test(s);

export async function listProducts(db: D1Database, input: unknown): Promise<ListProductsResult> {
  const parsed = listProductsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { from, to, q, limit } = parsed.data;
  if (from && to && from > to) return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };
  const needle = q ? normalizeForSearch(q) : "";

  const all: ProductRow[] = groupLines(await loadLines(db, from, to))
    .filter((g) => needle === "" || (isJanQuery(needle) ? g.jan === needle : [...g.names].some((n) => n.includes(needle)) || g.jan?.includes(needle)))
    .map((g) => ({
      product: g.product,
      lines: g.lines.length,
      quantity: round(g.lines.reduce((s, l) => s + qty(l), 0), 3),
      amount: g.lines.reduce((s, l) => s + l.amount, 0),
      // 行は新しい日付順に読んでいるので、先頭が最後に買った日
      last_date: g.lines[0]!.date,
      jan_code: g.jan,
      has_unit_price: g.lines.some((l) => computeUnitPrice(l) !== null),
    }));
  all.sort((a, b) => b.amount - a.amount || (a.product < b.product ? -1 : a.product > b.product ? 1 : 0));
  const products = all.slice(0, limit);
  return {
    ok: true,
    count: products.length,
    total: all.length,
    products,
    message: all.length === 0 ? "該当する商品はありません(明細のある取引が対象です)" : `${all.length}商品${all.length > products.length ? `(金額の大きい${products.length}件を返しました)` : ""}`,
  };
}

export async function productHistory(db: D1Database, input: unknown): Promise<ProductHistoryResult> {
  const parsed = productHistorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { product, from, to } = parsed.data;
  if (from && to && from > to) return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };
  const needle = normalizeForSearch(product);
  // 商品名、またはJANコードで当たるグループの行を、1つの商品として扱う(同じ商品名のグループが複数あっても合わせる)
  const matched = groupLines(await loadLines(db, from, to)).filter((g) => (isJanQuery(needle) ? g.jan === needle : g.names.has(needle)));
  const lines = matched.flatMap((g) => g.lines).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const janCodes = [...new Set(lines.map((l) => l.jan_code).filter((j): j is string => !!j))];
  if (lines.length === 0) {
    return { ok: true, product, jan_codes: [], lines: 0, quantity: 0, amount: 0, months: [], unit_price: null, purchases: [], message: `「${product}」の購入はありません(商品名は、list の結果の名前を使ってください)` };
  }

  const byMonth = new Map<string, LineRow[]>();
  for (const l of lines) {
    const m = l.date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), l]);
  }
  const months: MonthRow[] = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, ls]) => ({ month, lines: ls.length, quantity: round(ls.reduce((s, l) => s + qty(l), 0), 3), amount: ls.reduce((s, l) => s + l.amount, 0), unit_price: weightedUnitPrice(ls) }));

  const overall = weightedUnitPrice(lines);
  let unitSummary: UnitPriceSummary | null = null;
  if (overall) {
    const same = lines.filter((l) => l.content_unit === overall.unit && computeUnitPrice(l) !== null);
    const priced = same.map((l) => ({ l, up: computeUnitPrice(l)!.per_unit }));
    const latest = priced[0]!; // lines は新しい日付順
    const cheapest = priced.reduce((best, p) => (p.up < best.up ? p : best));
    unitSummary = {
      unit: overall.unit,
      latest: { per_unit: latest.up, date: latest.l.date },
      cheapest: { per_unit: cheapest.up, date: cheapest.l.date, merchant: cheapest.l.merchant },
      average: overall.per_unit,
    };
  }

  const purchases: PurchaseRow[] = lines.slice(0, MAX_HISTORY_PURCHASES).map((l) => ({
    date: l.date,
    transaction_id: l.transaction_id,
    merchant: l.merchant,
    name: l.name,
    quantity: qty(l),
    amount: l.amount,
    content_amount: l.content_amount,
    content_unit: l.content_unit,
    unit_price: computeUnitPrice(l),
  }));
  const quantity = round(lines.reduce((s, l) => s + qty(l), 0), 3);
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  return {
    ok: true,
    product: lines[0]!.key,
    jan_codes: janCodes,
    lines: lines.length,
    quantity,
    amount,
    months,
    unit_price: unitSummary,
    purchases,
    message: `「${lines[0]!.key}」: ${lines.length}回、合計${quantity}個(本・パック)、${amount.toLocaleString("ja-JP")}円${unitSummary ? `。単価の平均 ${round(unitSummary.average, 2)}円/${unitSummary.unit}` : ""}`,
  };
}
