import { describe, expect, it } from "vitest";
import type { HomeData, SummaryRow, TransactionView } from "../../src/api/contract";
import { barSegments, formatPercent, groupColor, isEmptyHome, memoView, percentOf, recentTitle, reviewHref, reviewLabel, shortDate } from "../../ui/src/pages/homeLogic";

const row = (key: string, total: number, percent: number): SummaryRow => ({ key, label: key, count: 1, total, percent });
const tx = (over: Partial<TransactionView>): TransactionView => ({
  id: "t1", date: "2026-10-11", amount: 100, merchant: null, category: null, account: null, memo: null, source: "manual", status: "confirmed", ...over,
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
  it("色は循環する", () => {
    expect(groupColor(7)).toBe(groupColor(0));
  });
});

describe("memoView", () => {
  it("件数から割合を計算する", () => {
    const v = memoView({ with_memo: 1, total: 4, percent: 0 });
    expect(v.percent).toBe(25);
    expect(v.text).toContain("4件中 1件");
  });
  it("0件", () => {
    expect(memoView({ with_memo: 0, total: 0, percent: 0 }).percent).toBe(0);
  });
});

describe("要確認・最近の記録", () => {
  it("要確認の行き先", () => {
    expect(reviewHref(home({ recent: [tx({ date: "2026-10-09", status: "needs_review" })] }))).toBe("/day/2026-10-09");
    expect(reviewHref(home({ recent: [tx({})] }))).toBe("/calendar?month=2026-10");
    expect(reviewLabel(3)).toBe("要確認の支出が3件あります");
  });
  it("見出し", () => {
    expect(recentTitle(tx({ merchant: "店", category: "食費" }))).toBe("店");
    expect(recentTitle(tx({ merchant: " ", category: "食費" }))).toBe("食費");
    expect(recentTitle(tx({}))).toBe("支出");
  });
  it("短い日付", () => {
    expect(shortDate("2026-10-01")).toBe("10/1");
  });
  it("空の判定", () => {
    expect(isEmptyHome(home())).toBe(true);
    expect(isEmptyHome(home({ recent: [tx({})] }))).toBe(false);
  });
});
