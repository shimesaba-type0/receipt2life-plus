import { describe, expect, it } from "vitest";
import type { HomeData, SummaryRow, TransactionView } from "../../src/api/contract";
import { GROUP_COLORS, barSegments, formatPercent, groupColor, isEmptyHome, memoView, monthRangeLabel, percentOf, recentMerchant, recentSub, reviewHref, reviewLabel, shortDate } from "../../ui/src/pages/homeLogic";

const row = (key: string, total: number, percent: number): SummaryRow => ({ key, label: key, count: 1, total, percent });
const tx = (over: Partial<TransactionView>): TransactionView => ({
  id: "t1", date: "2026-10-11", amount: 100, merchant: null, category: null, account: null, memo: null, source: "manual", status: "confirmed", tax_flag: null, items: [], ...over,
});
const home = (over: Partial<HomeData> = {}): HomeData => ({
  today: { date: "2026-10-11", total: 0, count: 0 },
  month: { month: "2026-10", from: "2026-10-01", to: "2026-10-31", total: 0, count: 0 },
  groups: [], memo: { with_memo: 0, total: 0, percent: 0 }, needs_review: 0, recent: [], ...over,
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
    expect(reviewHref(home({ recent: [tx({ date: "2026-10-09", status: "needs_review" })] }))).toBe("/day/2026-10-09");
    expect(reviewHref(home({ recent: [tx({})] }))).toBe("/calendar?month=2026-10");
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
