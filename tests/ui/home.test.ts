import { describe, expect, it } from "vitest";
import type { HomeData, SummaryRow, TransactionView } from "../../src/api/contract";
import { DISCOUNTS_NOTE, DONUT, GROUP_COLORS, INK, PAPER, barSegments, discountsView, donutSlices, formatPercent, groupColor, isEmptyHome, memoView, monthRangeLabel, percentOf, recentMerchant, recentSub, reviewHref, reviewLabel, shortDate, textColorOn } from "../../ui/src/pages/homeLogic";

const row = (key: string, total: number, percent: number): SummaryRow => ({ key, label: key, count: 1, total, percent });
const tx = (over: Partial<TransactionView>): TransactionView => ({
  id: "t1", date: "2026-10-11", amount: 100, merchant: null, category: null, account: null, memo: null, source: "manual", status: "confirmed", tax_flag: null, paid_time: null, merchant_phone: null, merchant_address: null, invoice_number: null, clerk_name: null, receipt_no: null, register_no: null, store_code: null, items: [], tax_lines: [], ...over,
});
const home = (over: Partial<HomeData> = {}): HomeData => ({
  today: { date: "2026-10-11", total: 0, count: 0 },
  month: { month: "2026-10", from: "2026-10-01", to: "2026-10-31", total: 0, count: 0 },
  groups: [], memo: { with_memo: 0, total: 0, percent: 0 }, discounts: { month_total: 0, month_line_count: 0 }, needs_review: 0, recent: [], ...over,
});

describe("formatPercent / percentOf", () => {
  it("丸めと範囲", () => {
    expect(formatPercent(33.333)).toBe("33.3%");
    expect(formatPercent(50)).toBe("50%");
    expect(formatPercent(120)).toBe("100%");
    expect(formatPercent(-5)).toBe("0%");
    expect(formatPercent(NaN)).toBe("0%");
  });
  it("全体が0なら0", () => {
    expect(percentOf(1, 0)).toBe(0);
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(3, 3)).toBe(100);
  });
});

describe("barSegments", () => {
  it("幅は金額の比で決まる", () => {
    const segs = barSegments([row("食費", 750, 75), row("交通", 250, 25)]);
    expect(segs.map((s) => s.width)).toEqual([75, 25]);
    expect(segs[0]?.color).toBe(groupColor(0));
  });
  it("0円の行は除く。空なら空", () => {
    expect(barSegments([row("a", 0, 0)])).toEqual([]);
    expect(barSegments([])).toEqual([]);
    expect(barSegments([row("a", 0, 0), row("b", 10, 100)])).toHaveLength(1);
  });
  it("配色は主色の濃淡と砂色、灰。7番目以降は灰系", () => {
    expect(GROUP_COLORS.slice(0, 5)).toEqual(["#1F5C4B", "#5E9C86", "#A9CDBF", "#C9B27A", "#B8BEBB"]);
    for (let i = 6; i < 20; i++) expect(["#B8BEBB", "#9CA5A1"]).toContain(groupColor(i));
  });
  it("出来事の色(赤橙緑青紫)と混ざらない", () => {
    const events = ["#c94b3f", "#d9822b", "#3e9b68", "#3b73c9", "#7c5bb5"];
    for (let i = 0; i < 20; i++) expect(events).not.toContain(groupColor(i).toLowerCase());
  });
});

describe("memoView", () => {
  it("件数から割合を計算する", () => {
    const v = memoView({ with_memo: 1, total: 4, percent: 0 });
    expect(v.percent).toBe(25);
    expect(v.text).toContain("4件中 1件");
    expect(v.percentText).toBe("25%");
    expect(v.ratioText).toBe("1 / 4件");
  });
  it("割合は整数に丸める", () => {
    expect(memoView({ with_memo: 11, total: 29, percent: 0 }).percentText).toBe("38%");
  });
  it("0件", () => {
    expect(memoView({ with_memo: 0, total: 0, percent: 0 }).percent).toBe(0);
  });
});

describe("要確認・最近の記録", () => {
  it("要確認の行き先", () => {
    expect(reviewHref()).toBe("/review");
    expect(reviewLabel(3)).toBe("要確認の記録が3件あります");
  });
  it("店名とサブ行", () => {
    expect(recentMerchant(tx({ merchant: "店" }))).toEqual({ title: "店", missing: false });
    expect(recentMerchant(tx({ merchant: " " }))).toEqual({ title: "店名なし", missing: true });
    expect(recentMerchant(tx({}))).toEqual({ title: "店名なし", missing: true });
    expect(recentSub(tx({ category: "食費", account: "現金" }))).toBe("食費・現金");
    expect(recentSub(tx({ category: "食費" }))).toBe("食費");
    expect(recentSub(tx({ account: "現金" }))).toBe("現金");
    expect(recentSub(tx({}))).toBe("");
  });
  it("今月の範囲", () => {
    expect(monthRangeLabel("2026-10-01", "2026-10-11")).toBe("10月1日〜11日");
    expect(monthRangeLabel("2026-10-01", "2026-10-01")).toBe("10月1日");
    expect(monthRangeLabel("2026-10-01", "2026-11-02")).toBe("10月1日〜31日");
  });
  it("短い日付", () => {
    expect(shortDate("2026-10-01")).toBe("10/1");
  });
  it("空の判定", () => {
    expect(isEmptyHome(home())).toBe(true);
    expect(isEmptyHome(home({ recent: [tx({})] }))).toBe(false);
  });
});

describe("discountsView(今月の割引カード)", () => {
  it("金額と件数と注記", () => {
    const v = discountsView({ month_total: 1230, month_line_count: 3 });
    expect(v.empty).toBe(false);
    expect(v.amountText).toBe("¥1,230");
    expect(v.countText).toBe("3件の割引");
    expect(v.note).toBe(DISCOUNTS_NOTE);
    expect(v.note).toContain("印字された割引行のみ");
    expect(v.ariaLabel).toBe("今月の割引 ¥1,230、3件の割引");
  });
  it("割引がないときは「今月の割引はまだありません」", () => {
    const v = discountsView(home().discounts);
    expect(v.empty).toBe(true);
    expect(v.countText).toBe("今月の割引はまだありません");
    expect(v.amountText).toBe("");
    expect(v.note).toBe(DISCOUNTS_NOTE);
  });
  it("不正な値は0として扱う", () => {
    expect(discountsView(undefined).empty).toBe(true);
    expect(discountsView({ month_total: -5, month_line_count: NaN }).empty).toBe(true);
    expect(discountsView({ month_total: 100, month_line_count: 0 }).countText).toBe("0件の割引");
  });
});

describe("ドーナツグラフ", () => {
  const rows = (...totals: number[]) => {
    const sum = totals.reduce((a, b) => a + b, 0);
    return totals.map((t, i) => ({ key: `g${i}`, label: `区分${i}`, total: t, count: 1, percent: Math.round((t / sum) * 1000) / 10 }));
  };

  it("区分の長さは円周の比で、合計が円周になる(区分の間の隙間を足すと1周)", () => {
    const slices = donutSlices(rows(500, 300, 200));
    const circ = 2 * Math.PI * DONUT.r;
    const sum = slices.reduce((a, s) => a + s.dash + 1.6, 0);
    expect(sum).toBeCloseTo(circ, 5);
    expect(slices[0]?.offset).toBeCloseTo(0, 5);
    expect(slices[1]?.offset).toBeCloseTo(-circ * 0.5, 5);
  });

  it("%は大きい順に最大5つ、10%以上の区分だけリングの中に入れる", () => {
    const s = donutSlices(rows(30, 25, 15, 10, 8, 7, 5));
    const labeled = s.filter((x) => x.inner).map((x) => x.key);
    expect(labeled).toEqual(["g0", "g1", "g2", "g3"]); // 10% 以上は4つ。8%以下は入れない
    expect(s[0]?.inner?.text).toBe("30%");
    const many = donutSlices(rows(20, 20, 20, 15, 15, 10));
    expect(many.filter((x) => x.inner)).toHaveLength(5); // 10%以上が6つあっても5つまで
  });

  it("区分が1つだけなら、隙間なしで1周し、100%を入れる", () => {
    const [only] = donutSlices(rows(1234));
    expect(only?.dash).toBeCloseTo(2 * Math.PI * DONUT.r, 5);
    expect(only?.inner?.text).toBe("100%");
  });

  it("金額が0以下の区分は出さない。空なら空", () => {
    expect(donutSlices(rows(100, 0))).toHaveLength(1);
    expect(donutSlices([])).toEqual([]);
  });

  it("%の位置は、区分の真ん中の角度のリング上(最初の区分は12時から右回り)", () => {
    const [a] = donutSlices(rows(50, 50));
    const c = DONUT.size / 2;
    // 先頭の区分は 0〜50%(12時→6時)。真ん中は3時の位置
    expect(a?.inner?.x).toBeCloseTo(c + DONUT.r, 5);
    expect(a?.inner?.y).toBeCloseTo(c, 5);
  });

  it("文字色は、背景に対して読みやすいほう(真っ白・真っ黒は使わない)", () => {
    expect(textColorOn("#1F5C4B")).toBe(PAPER);
    expect(textColorOn("#A9CDBF")).toBe(INK);
    for (const color of GROUP_COLORS) expect([PAPER, INK]).toContain(textColorOn(color));
  });
});
