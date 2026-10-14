import { describe, expect, it } from "vitest";
import type { ProductRowView } from "../../src/api/contract";
import { addMonths } from "../../ui/src/format";
import { parseRoute } from "../../ui/src/route";
import { parseProductFields, emptyItemRow, buildItems, itemRowsFromView, janCheckDigitOk, normalizeJan, parseJan } from "../../ui/src/pages/transactionLogic";
import { diffText, formatUnitYen, itemProductLine, monthlyCells, normalizePer, perLabel, quantityBar, quantityText, unitPriceLabel, withPrevious } from "../../ui/src/pages/productsLogic";

const row = (product: string, quantity: number, amount = 100): ProductRowView => ({ product, lines: 1, quantity, amount, last_date: "2026-10-05", jan_code: null, has_unit_price: false });

describe("商品の画面の純粋な部分", () => {
  it("ルート: /products(月・商品名)", () => {
    expect(parseRoute("/products")).toEqual({ name: "products", month: null, product: null });
    expect(parseRoute("/products", "?month=2026-09&product=%E7%89%9B%E4%B9%B3")).toEqual({ name: "products", month: "2026-09", product: "牛乳" });
    expect(parseRoute("/products", "?month=bad&product=%20")).toEqual({ name: "products", month: null, product: null });
  });

  it("単価の文言: 単位あたり。表示の単位を変えられる(100ml→1L)", () => {
    expect(unitPriceLabel({ per_unit: 0.198, unit: "ml" })).toBe("100mlあたり ¥19.8");
    expect(unitPriceLabel({ per_unit: 0.198, unit: "ml" }, 1000)).toBe("1Lあたり ¥198");
    expect(unitPriceLabel({ per_unit: 0.86, unit: "g" }, 100)).toBe("100gあたり ¥86");
    expect(unitPriceLabel({ per_unit: 0.86, unit: "g" }, 1000)).toBe("1kgあたり ¥860");
    expect(unitPriceLabel({ per_unit: 25, unit: "個" })).toBe("1個あたり ¥25");
    // 使えない単位なら既定
    expect(normalizePer("個", 100)).toBe(1);
    expect(normalizePer("ml", 7)).toBe(100);
    expect(perLabel("ml", 1)).toBe("1ml");
  });

  it("円の表示: 100円以上は整数、1円以上は小数第1位、1円未満は小数第2位", () => {
    expect(formatUnitYen(1234.5)).toBe("¥1,235");
    expect(formatUnitYen(19.8)).toBe("¥19.8");
    expect(formatUnitYen(25)).toBe("¥25");
    expect(formatUnitYen(0.198)).toBe("¥0.2");
    expect(formatUnitYen(0.0555)).toBe("¥0.06");
  });

  it("明細の行の補足(×数・内容量・単価)。無ければ null", () => {
    expect(itemProductLine({ quantity: 2, content_amount: 1000, content_unit: "ml", unit_price: { per_unit: 0.198, unit: "ml" } })).toBe("×2 ・ 1,000ml ・ 100mlあたり ¥19.8");
    expect(itemProductLine({ quantity: 1, content_amount: 10, content_unit: "個", unit_price: { per_unit: 25, unit: "個" } })).toBe("10個 ・ 1個あたり ¥25");
    expect(itemProductLine({ quantity: null, content_amount: null, content_unit: null, unit_price: null })).toBeNull();
  });

  it("先月との比較: 今月の順を保ち、先月だけの商品は含めない", () => {
    const merged = withPrevious([row("牛乳", 5), row("卵", 2), row("パン", 1)], [row("牛乳", 3), row("卵", 2), row("バター", 4)]);
    expect(merged.map((m) => [m.product, m.previous, m.diff])).toEqual([["牛乳", 3, 2], ["卵", 2, 0], ["パン", 0, 1]]);
    expect(diffText(merged[0]!)).toBe("先月より +2");
    expect(diffText(merged[1]!)).toBe("先月と同じ");
    expect(diffText(merged[2]!)).toBe("先月は買っていない");
    expect(diffText({ previous: 5, diff: -2 })).toBe("先月より −2");
    expect(quantityText(2.5)).toBe("2.5");
  });

  it("直近の月ごと: 買わなかった月は 0 で入れる。棒は最大を100%にする", () => {
    const cells = monthlyCells([{ month: "2026-10", quantity: 5, amount: 990, unit_price: null }, { month: "2026-08", quantity: 2, amount: 400, unit_price: null }], "2026-10", 4, addMonths);
    expect(cells.map((c) => [c.month, c.quantity, c.bought])).toEqual([["2026-07", 0, false], ["2026-08", 2, true], ["2026-09", 0, false], ["2026-10", 5, true]]);
    expect(quantityBar(5, 5)).toBe(100);
    expect(quantityBar(2, 5)).toBe(40);
    expect(quantityBar(0, 5)).toBe(0);
  });
});

describe("明細の行の商品の情報(入力・往復)", () => {
  it("フォームの文字を、検証して API の入力にする。空は null", () => {
    const r = { ...emptyItemRow("a"), product: " 牛乳 ", quantity: "2", content_amount: "１,000", content_unit: "ml" };
    expect(parseProductFields(r, 1)).toEqual({ ok: true, value: { product: "牛乳", quantity: 2, content_amount: 1000, content_unit: "ml", jan_code: null } });
    expect(parseProductFields(emptyItemRow("b"), 1)).toEqual({ ok: true, value: { product: null, quantity: null, content_amount: null, content_unit: null, jan_code: null } });
  });

  it("エラー: 片方だけ・桁数・範囲・不正な単位", () => {
    const base = emptyItemRow("a");
    for (const patch of [{ content_amount: "10" }, { content_unit: "個" }, { quantity: "0" }, { quantity: "1.2345" }, { content_amount: "x", content_unit: "g" }, { content_amount: "10", content_unit: "kg" }, { product: "あ".repeat(51) }]) {
      expect(parseProductFields({ ...base, ...patch }, 3).ok, JSON.stringify(patch)).toBe(false);
    }
    expect(parseProductFields({ ...base, content_amount: "10" }, 3)).toEqual({ ok: false, error: "3行目: 内容量と単位は、両方入れるか、両方空にしてください。" });
  });

  it("画面で明細を直して保存しても、商品の情報が消えない(丸ごと置き換えのため送り直す)", () => {
    const rows = itemRowsFromView([{ id: "i", position: 0, name: "牛乳 1L", amount: 198, category: null, tax_flag: null, memo: null, tax_rate: null, tax_label: null, product: "牛乳", quantity: 2, content_amount: 1000, content_unit: "ml", jan_code: null, unit_price: { per_unit: 0.099, unit: "ml" } }]);
    expect(rows[0]).toMatchObject({ product: "牛乳", quantity: "2", content_amount: "1000", content_unit: "ml" });
    expect(buildItems(rows)).toMatchObject({ ok: true, value: [{ name: "牛乳 1L", product: "牛乳", quantity: 2, content_amount: 1000, content_unit: "ml" }] });
    // 商品の情報だけを入れた行は空行ではない(品名が要る)
    expect(buildItems([{ ...emptyItemRow("z"), product: "牛乳" }])).toMatchObject({ ok: false });
  });
});

describe("JANコード(画面の入力)", () => {
  it("検査桁・正規化(サーバーと同じ規則)", () => {
    expect(janCheckDigitOk("4901234567894")).toBe(true);
    expect(janCheckDigitOk("49123456")).toBe(true);
    expect(janCheckDigitOk("4901234567895")).toBe(false);
    expect(normalizeJan("４９０１-２３４５ 678　94")).toBe("4901234567894");
  });

  it("入力: 空は null。桁数・検査桁・文字の不正は、行番号つきのエラー", () => {
    expect(parseJan("", 1)).toEqual({ ok: true, value: null });
    expect(parseJan(" 4901-2345-67894 ", 1)).toEqual({ ok: true, value: "4901234567894" });
    expect(parseJan("49123456", 2)).toEqual({ ok: true, value: "49123456" });
    expect(parseJan("12345", 2)).toEqual({ ok: false, error: "2行目: JANコードは、8桁か13桁の数字で入力してください。" });
    expect(parseJan("4901234567895", 3)).toEqual({ ok: false, error: "3行目: JANコードの末尾の検査桁が合いません(読み間違いの可能性があります)。" });
    expect(parseJan("49012345678AB", 1).ok).toBe(false);
  });

  it("明細の行の往復で JAN が消えない。JAN だけを入れた行は空行ではない", () => {
    const rows = itemRowsFromView([{ id: "i", position: 0, name: "牛乳", amount: 198, category: null, tax_flag: null, memo: null, tax_rate: null, tax_label: null, product: null, quantity: null, content_amount: null, content_unit: null, jan_code: "4901234567894", unit_price: null }]);
    expect(rows[0]).toMatchObject({ jan_code: "4901234567894" });
    expect(buildItems(rows)).toMatchObject({ ok: true, value: [{ name: "牛乳", jan_code: "4901234567894" }] });
    expect(buildItems([{ ...emptyItemRow("z"), jan_code: "4901234567894" }])).toMatchObject({ ok: false });
    expect(buildItems([{ ...emptyItemRow("z"), name: "a", amount: "1", jan_code: "4901234567895" }])).toMatchObject({ ok: false });
  });
});

