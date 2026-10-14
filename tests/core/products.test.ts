import { describe, expect, it } from "vitest";
import { computeUnitPrice, janCheckDigitOk, normalizeJan } from "../../src/core/item-products";
import { listProducts, productHistory } from "../../src/core/products";
import { addTransactions, getTransaction, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

type Item = { name: string; amount: number; product?: string; quantity?: number; content_amount?: number; content_unit?: "g" | "ml" | "個"; jan_code?: string };
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
      { product: "牛乳", lines: 2, quantity: 3, amount: 594, last_date: "2026-10-09", jan_code: null, has_unit_price: true, content_total: { amount: 3000, unit: "ml" } },
      { product: "食パン", lines: 1, quantity: 1, amount: 150, last_date: "2026-10-05", jan_code: null, has_unit_price: false, content_total: null },
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

// ダミーの例(桁の規則を満たす汎用の例。実在の商品とは関係ない)
const JAN13 = "4901234567894";
const JAN8 = "49123456";

describe("JANコード", () => {
  it("チェックデジットの検証と正規化(全角・ハイフン・空白を取り除く)", () => {
    expect(janCheckDigitOk(JAN13)).toBe(true);
    expect(janCheckDigitOk(JAN8)).toBe(true);
    expect(janCheckDigitOk("4901234567895")).toBe(false);
    expect(janCheckDigitOk("49123457")).toBe(false);
    expect(normalizeJan("４９０１-２３４５ 678　94")).toBe(JAN13);
  });

  it("登録・返却: 正規化して保存する。桁数・検査桁・文字の不正はエラー", async () => {
    const id = await buy("2026-10-05", "A店", [{ name: "牛乳", amount: 198, jan_code: "4901-2345-67894" as string }]);
    const t = await getTransaction(db(), id);
    expect(t.ok && t.transaction.items[0]!.jan_code).toBe(JAN13);
    const bad = async (jan: string) => (await addTransactions(db(), { transactions: [{ date: "2026-10-05", amount: 100, items: [{ name: "x", amount: 100, jan_code: jan }] }] }, { now: NOW })).ok;
    expect(await bad(JAN8)).toBe(true);
    for (const jan of ["4901234567895", "490123456789", "49012345678945", "abc", "49012345678 9X", ""]) expect(await bad(jan), jan).toBe(false);
  });

  it("同じJANは、品名の表記が違っても1つの商品にまとめる。JANの無い同名の行も、JANが1種類ならそこに入る", async () => {
    await buy("2026-10-02", "A店", [{ name: "雪印牛乳 1L", amount: 198, product: "牛乳", jan_code: JAN13 }]);
    await buy("2026-10-05", "B店", [{ name: "MILK 1000ml", amount: 190, jan_code: JAN13 }]);
    await buy("2026-10-08", "A店", [{ name: "牛乳", amount: 200, product: "牛乳" }]);
    await buy("2026-10-09", "A店", [{ name: "バナナ", amount: 100 }]);
    const list = await listProducts(db(), {});
    expect(list.ok && list.products.map((p) => [p.product, p.lines, p.amount, p.jan_code])).toEqual([
      ["牛乳", 3, 588, JAN13],
      ["バナナ", 1, 100, null],
    ]);
    // JAN でも、商品名でも、同じ履歴になる
    const byJan = await productHistory(db(), { product: JAN13 });
    const byName = await productHistory(db(), { product: "牛乳" });
    expect(byJan.ok && byJan.lines).toBe(3);
    expect(byName.ok && byName.lines).toBe(3);
    expect(byJan.ok && byJan.jan_codes).toEqual([JAN13]);
    // 一覧の絞り込みも JAN で当たる
    expect((await listProducts(db(), { q: JAN13 })).ok && (await listProducts(db(), { q: JAN13 }) as { total: number }).total).toBe(1);
    expect((await listProducts(db(), { q: "4901234" })).ok && (await listProducts(db(), { q: "4901234" }) as { total: number }).total).toBe(1);
  });

  it("同じ品名に別々のJANが付いていれば、品名だけの行はどちらにも入れない(別の商品のまま)", async () => {
    await buy("2026-10-02", "A店", [{ name: "牛乳", amount: 198, jan_code: JAN13 }]);
    await buy("2026-10-03", "A店", [{ name: "牛乳", amount: 150, jan_code: JAN8 }]);
    await buy("2026-10-04", "A店", [{ name: "牛乳", amount: 100 }]);
    const list = await listProducts(db(), {});
    expect(list.ok && list.products.map((p) => [p.lines, p.jan_code]).sort()).toEqual([[1, JAN13], [1, JAN8], [1, null]].sort());
    // 品名で引くと、3つとも同じ「牛乳」として合わせて返る
    const h = await productHistory(db(), { product: "牛乳" });
    expect(h.ok && h.lines).toBe(3);
  });
});

describe("商品の一覧の並び順と、毎回量が違うもの", () => {
  it("sort=frequency は買った回数の多い順(同数は金額順)。既定は金額順", async () => {
    await buy("2026-10-01", "A店", [{ name: "高い物", amount: 5000 }, { name: "卵", amount: 250 }]);
    await buy("2026-10-03", "A店", [{ name: "卵", amount: 260 }]);
    await buy("2026-10-05", "A店", [{ name: "卵", amount: 240 }, { name: "パン", amount: 150 }]);
    const range = { from: "2026-10-01", to: "2026-10-31" };
    const byAmount = await listProducts(db(), range);
    expect(byAmount.ok && byAmount.products.map((p) => p.product)).toEqual(["高い物", "卵", "パン"]);
    const byFreq = await listProducts(db(), { ...range, sort: "frequency" });
    expect(byFreq.ok && byFreq.products.map((p) => [p.product, p.lines])).toEqual([["卵", 3], ["高い物", 1], ["パン", 1]]);
    expect((await listProducts(db(), { ...range, sort: "bad" })).ok).toBe(false);
  });

  it("ガソリンは product でまとめ、回数・合計の量(L)・1Lあたりの単価が出る。映画は product だけでまとまる", async () => {
    await buy("2026-10-02", "Gスタンド", [{ name: "レギュラー 38.15L @161.0", amount: 6142, product: "ガソリン(レギュラー)", quantity: 1, content_amount: 38150, content_unit: "ml" }]);
    await buy("2026-10-08", "Gスタンド", [{ name: "レギュラー 20.00L @163.0", amount: 3260, product: "ガソリン(レギュラー)", quantity: 1, content_amount: 20000, content_unit: "ml" }]);
    await buy("2026-10-04", "映画館", [{ name: "JRジョジョショーツ", amount: 1080, product: "映画" }]);
    await buy("2026-10-06", "映画館", [{ name: "大人 ディスクロージャー・デイ(字幕)", amount: 1500, product: "映画" }]);
    const r = await listProducts(db(), { from: "2026-10-01", to: "2026-10-31", sort: "frequency" });
    expect(r.ok && r.products.map((p) => [p.product, p.lines, p.quantity, p.amount, p.content_total])).toEqual([
      ["ガソリン(レギュラー)", 2, 2, 9402, { amount: 58150, unit: "ml" }],
      ["映画", 2, 2, 2580, null],
    ]);
    const h = await productHistory(db(), { product: "ガソリン(レギュラー)" });
    expect(h.ok && h.unit_price?.average).toBeCloseTo(0.1617, 3);
  });
});
