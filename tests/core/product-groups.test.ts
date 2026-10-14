import { describe, expect, it } from "vitest";
import { buildGroupMatcher, createGroup, deleteGroup, listGroups, updateGroup } from "../../src/core/product-groups";
import { listProducts, productHistory } from "../../src/core/products";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

async function buy(date: string, items: { name: string; amount: number; product?: string; quantity?: number; content_amount?: number; content_unit?: "g" | "ml" | "個" }[]) {
  const amount = items.reduce((s, i) => s + i.amount, 0);
  const r = await addTransactions(db(), { transactions: [{ date, amount, merchant: "A店", category: "食費", items, allow_duplicate: true }] }, { now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
}
const range = { from: "2026-10-01", to: "2026-10-31" };

describe("まとめ名の判定", () => {
  it("まとめ名・言葉を含む名前が入る。いちばん長い言葉が勝つ(同じ長さなら先に作ったまとめ)。表記の違いは区別しない", () => {
    const m = buildGroupMatcher([
      { id: "1", name: "牛乳", words: ["ミルク", "低脂肪乳"] },
      { id: "2", name: "酢", words: [] },
      { id: "3", name: "味噌", words: [] },
      { id: "4", name: "酢味噌", words: [] },
    ]);
    expect(m("明治 おいしい牛乳")).toBe("牛乳");
    expect(m("ミルク 1L")).toBe("牛乳");
    expect(m("みるく")).toBe("牛乳");
    expect(m("みどり 低脂肪乳")).toBe("牛乳");
    expect(m("酢味噌ドレッシング")).toBe("酢味噌");
    expect(m("白味噌")).toBe("味噌");
    expect(m("米酢")).toBe("酢");
    expect(m("卵")).toBeNull();
  });
});

describe("まとめ名ごとの集計(by=group)", () => {
  it("牛乳・ミルク・低脂肪乳を1つにくくり、元の明細は変えない。当たらない商品はそのまま。by=product は従来どおり", async () => {
    await buy("2026-10-02", [{ name: "雪印 牛乳", amount: 200, product: "牛乳", content_amount: 1000, content_unit: "ml" }, { name: "卵", amount: 250 }]);
    await buy("2026-10-04", [{ name: "メーカーA ミルク", amount: 180, content_amount: 900, content_unit: "ml" }]);
    await buy("2026-10-06", [{ name: "みどり 低脂肪乳", amount: 220, content_amount: 1000, content_unit: "ml" }]);
    const g = await createGroup(db(), { name: "牛乳", words: ["ミルク", "低脂肪乳"] });
    expect(g.ok).toBe(true);

    const byGroup = await listProducts(db(), { ...range, by: "group" });
    expect(byGroup.ok && byGroup.products.map((p) => [p.product, p.lines, p.amount])).toEqual([["牛乳", 3, 600], ["卵", 1, 250]]);
    const byProduct = await listProducts(db(), range);
    expect(byProduct.ok && byProduct.products.map((p) => p.product).sort()).toEqual(["メーカーA ミルク", "みどり 低脂肪乳", "卵", "牛乳"].sort());

    const h = await productHistory(db(), { product: "牛乳", by: "group" });
    expect(h.ok && [h.lines, h.amount, h.unit_price?.unit]).toEqual([3, 600, "ml"]);
    // 商品ごとの履歴は、そのまま
    const h2 = await productHistory(db(), { product: "牛乳" });
    expect(h2.ok && h2.lines).toBe(1);
  });

  it("1つの商品が複数のまとめに当たっても、いちばん長い言葉のまとめにだけ入る(二重に数えない)", async () => {
    await buy("2026-10-02", [{ name: "酢味噌", amount: 300 }, { name: "米酢", amount: 200 }, { name: "白味噌", amount: 400 }]);
    for (const name of ["酢", "味噌", "酢味噌"]) expect((await createGroup(db(), { name })).ok).toBe(true);
    const r = await listProducts(db(), { ...range, by: "group" });
    expect(r.ok && r.products.map((p) => [p.product, p.amount])).toEqual([["味噌", 400], ["酢味噌", 300], ["酢", 200]].sort((a, b) => (b[1] as number) - (a[1] as number)));
    expect(r.ok && r.products.reduce((s, p) => s + p.amount, 0)).toBe(900);
  });
});

describe("まとめ名の管理", () => {
  it("作る・直す・消す。同じ言葉は別のまとめに入れられない。重複・空・多すぎはエラー", async () => {
    const a = await createGroup(db(), { name: "牛乳", words: ["ミルク", "ミルク", "牛乳", "ﾐﾙｸ"] });
    expect(a.ok && a.group.words).toEqual(["ミルク"]);
    if (!a.ok) throw new Error("create failed");
    expect((await createGroup(db(), { name: "牛乳" })).ok).toBe(false);
    expect((await createGroup(db(), { name: "乳", words: ["ミルク"] })).ok).toBe(false);
    expect((await createGroup(db(), { name: "", words: [] })).ok).toBe(false);
    expect((await createGroup(db(), { name: "x", words: Array.from({ length: 21 }, (_, i) => `w${i}`) })).ok).toBe(false);
    expect((await createGroup(db(), { name: "あ".repeat(31) })).ok).toBe(false);

    const up = await updateGroup(db(), a.group.id, { name: "牛乳", words: ["低脂肪乳"] });
    expect(up.ok && up.group.words).toEqual(["低脂肪乳"]);
    expect((await updateGroup(db(), "none", { name: "x" })).ok).toBe(false);
    const l = await listGroups(db());
    expect(l.ok && l.groups.map((g) => [g.name, g.words])).toEqual([["牛乳", ["低脂肪乳"]]]);

    expect((await deleteGroup(db(), a.group.id)).ok).toBe(true);
    expect((await deleteGroup(db(), a.group.id)).ok).toBe(false);
    const after = await db().prepare("SELECT COUNT(*) AS n FROM product_group_words").first<{ n: number }>();
    expect(after?.n).toBe(0);
  });
});
