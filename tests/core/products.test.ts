import { describe, expect, it } from "vitest";
import { computeUnitPrice } from "../../src/core/item-products";
import { listProducts, productHistory } from "../../src/core/products";
import { addTransactions, getTransaction, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

type Item = { name: string; amount: number; product?: string; quantity?: number; content_amount?: number; content_unit?: "g" | "ml" | "個" };
async function buy(date: string, merchant: string, items: Item[], extra: Record<string, unknown> = {}) {
  const amount = items.reduce((s, i) => s + i.amount, 0);
  const r = await addTransactions(db(), { transactions: [{ date, amount, merchant, category: "食費", items, allow_duplicate: true, ...extra }] }, { now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.registered[0]!.id;
}

describe("computeUnitPrice", () => {
  it("金額÷(買った数×内容量)。内容量が無い行・値引きの行は null", () => {
    expect(computeUnitPrice({ amount: 250, content_amount: 10, content_unit: "個" })).toEqual({ per_unit: 25, unit: "個" });
    expect(computeUnitPrice({ amount: 396, quantity: 2, content_amount: 1000, content_unit: "ml" })).toEqual({ per_unit: 0.198, unit: "ml" });
    expect(computeUnitPrice({ amount: 258, content_amount: 300, content_unit: "g" })!.per_unit).toBeCloseTo(0.86, 10);
    expect(computeUnitPrice({ amount: 250 })).toBeNull();
    expect(computeUnitPrice({ amount: -50, content_amount: 1, content_unit: "個" })).toBeNull();
  });
});

describe("明細の商品の情報", () => {
  it("登録した商品の情報と、計算した単価が取引の明細に返る。画面での更新でも消えない", async () => {
    const id = await buy("2026-10-05", "ダミー商店", [{ name: "卵 10個入", amount: 250, product: "卵", content_amount: 10, content_unit: "個" }, { name: "牛乳 1L", amount: 198, product: "牛乳", quantity: 1, content_amount: 1000, content_unit: "ml" }]);
    const t = await getTransaction(db(), id);
    expect(t.ok && t.transaction.items.map((i) => [i.product, i.quantity, i.content_amount, i.content_unit, i.unit_price])).toEqual([
      ["卵", null, 10, "個", { per_unit: 25, unit: "個" }],
      ["牛乳", 1, 1000, "ml", { per_unit: 0.198, unit: "ml" }],
    ]);
    // 明細を丸ごと置き換える更新で、商品の情報も送り直せば残る
    const up = await updateTransaction(db(), { id, items: [{ name: "卵 10個入", amount: 250, product: "卵", content_amount: 10, content_unit: "個" }, { name: "牛乳 1L", amount: 198, product: "牛乳", content_amount: 1000, content_unit: "ml" }] }, { now: NOW });
    expect(up.ok && up.transaction.items[0]).toMatchObject({ product: "卵", unit_price: { per_unit: 25 } });
  });

  it("内容量と単位は両方か、両方なし。範囲・単位の不正はエラー", async () => {
    const bad = async (item: Record<string, unknown>) => (await addTransactions(db(), { transactions: [{ date: "2026-10-05", amount: 100, items: [{ name: "x", amount: 100, ...item }] }] }, { now: NOW })).ok;
    expect(await bad({ content_amount: 10 })).toBe(false);
    expect(await bad({ content_unit: "個" })).toBe(false);
    expect(await bad({ content_amount: 0, content_unit: "g" })).toBe(false);
    expect(await bad({ content_amount: 10, content_unit: "kg" })).toBe(false);
    expect(await bad({ quantity: 0 })).toBe(false);
    expect(await bad({ quantity: 1.2345 })).toBe(false);
    expect(await bad({ product: "あ".repeat(51) })).toBe(false);
    expect(await bad({ product: "牛乳", quantity: 2, content_amount: 1000, content_unit: "ml" })).toBe(true);
  });
});

describe("listProducts / productHistory", () => {
  it("商品名(product、無ければ品名)ごとに、買った数・金額・最後に買った日を出す。値引きは数えない", async () => {
    await buy("2026-10-05", "A店", [{ name: "雪印牛乳 1L", amount: 198, product: "牛乳", content_amount: 1000, content_unit: "ml" }, { name: "食パン", amount: 150 }, { name: "割引", amount: -20 }]);
    await buy("2026-10-09", "B店", [{ name: "牛乳1000ml", amount: 396, product: "牛乳", quantity: 2, content_amount: 1000, content_unit: "ml" }]);
    await buy("2026-09-20", "A店", [{ name: "牛乳", amount: 190, product: "牛乳" }]);
    const r = await listProducts(db(), { from: "2026-10-01", to: "2026-10-31" });
    expect(r.ok && r.products).toEqual([
      { product: "牛乳", lines: 2, quantity: 3, amount: 594, last_date: "2026-10-09", has_unit_price: true },
      { product: "食パン", lines: 1, quantity: 1, amount: 150, last_date: "2026-10-05", has_unit_price: false },
    ]);
    const filtered = await listProducts(db(), { q: "ぎゅうにゅう" });
    expect(filtered.ok && filtered.total).toBe(0);
    expect((await listProducts(db(), { q: "牛" })).ok && (await listProducts(db(), { q: "牛" }) as { total: number }).total).toBe(1);
    expect((await listProducts(db(), { from: "2026-10-02", to: "2026-10-01" })).ok).toBe(false);
  });

  it("商品の履歴: 月ごとの買った数・金額・単価、最新・最安・平均、買い物の一覧(新しい順)", async () => {
    await buy("2026-08-10", "A店", [{ name: "卵", amount: 220, product: "卵", content_amount: 10, content_unit: "個" }]);
    await buy("2026-09-10", "B店", [{ name: "卵", amount: 200, product: "卵", content_amount: 10, content_unit: "個" }]);
    await buy("2026-10-05", "A店", [{ name: "卵 10個", amount: 250, product: "卵", content_amount: 10, content_unit: "個" }]);
    await buy("2026-10-10", "A店", [{ name: "卵 10個", amount: 500, product: "卵", quantity: 2, content_amount: 10, content_unit: "個" }]);
    const h = await productHistory(db(), { product: "卵" });
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h).toMatchObject({ product: "卵", lines: 4, quantity: 5, amount: 1170 });
    expect(h.months.map((m) => [m.month, m.quantity, m.amount, m.unit_price?.per_unit])).toEqual([
      ["2026-08", 1, 220, 22],
      ["2026-09", 1, 200, 20],
      ["2026-10", 3, 750, 25],
    ]);
    expect(h.unit_price).toMatchObject({ unit: "個", latest: { per_unit: 25, date: "2026-10-10" }, cheapest: { per_unit: 20, date: "2026-09-10", merchant: "B店" } });
    expect(h.unit_price!.average).toBeCloseTo(1170 / 50, 10);
    expect(h.purchases.map((p) => p.date)).toEqual(["2026-10-10", "2026-10-05", "2026-09-10", "2026-08-10"]);
    // 表記ゆれ(全角)でも当たる
    expect((await productHistory(db(), { product: "たまご" })).ok && (await productHistory(db(), { product: "たまご" }) as { lines: number }).lines).toBe(0);
  });

  it("単位がまざる商品は、いちばん多い単位で単価を出す。購入のない商品は空で返す", async () => {
    await buy("2026-10-01", "A店", [{ name: "鶏肉", amount: 300, product: "鶏肉", content_amount: 300, content_unit: "g" }]);
    await buy("2026-10-02", "A店", [{ name: "鶏肉", amount: 280, product: "鶏肉", content_amount: 280, content_unit: "g" }]);
    await buy("2026-10-03", "A店", [{ name: "鶏肉", amount: 400, product: "鶏肉", content_amount: 2, content_unit: "個" }]);
    const h = await productHistory(db(), { product: "鶏肉" });
    expect(h.ok && h.unit_price?.unit).toBe("g");
    const none = await productHistory(db(), { product: "存在しない" });
    expect(none).toMatchObject({ ok: true, lines: 0, months: [], purchases: [] });
    expect((await productHistory(db(), { product: "" })).ok).toBe(false);
  });
});
