import { describe, expect, it } from "vitest";
import { baseParam, compareApiPath, defaultUntilDay, deltaDirection, monthTitle, percentLabel, signedYen } from "../../ui/src/pages/compareLogic";

describe("月の比較の純粋な部分", () => {
  it("base: 月を指定は、正しい月のときだけ", () => {
    expect(baseParam("previous", "")).toBe("previous");
    expect(baseParam("year_ago", "x")).toBe("year_ago");
    expect(baseParam("custom", "2026-09")).toBe("2026-09");
    expect(baseParam("custom", "")).toBeNull();
    expect(baseParam("custom", "2026-13")).toBeNull();
  });
  it("API のパス", () => {
    expect(compareApiPath("2026-10", "previous", null)).toBe("/api/compare?month=2026-10&base=previous");
    expect(compareApiPath("2026-10", "2026-09", 12)).toBe("/api/compare?month=2026-10&base=2026-09&until_day=12");
  });
  it("同じ日までは、今月(途中の月)だけ", () => {
    expect(defaultUntilDay("2026-10", "2026-10-13")).toBe(13);
    expect(defaultUntilDay("2026-09", "2026-10-13")).toBeNull();
  });
  it("表示用の文言", () => {
    expect(signedYen(12000)).toBe("+¥12,000");
    expect(signedYen(-3000)).toBe("-¥3,000");
    expect(signedYen(0)).toBe("±¥0");
    expect(percentLabel(15)).toBe("+15%");
    expect(percentLabel(-8.5)).toBe("-8.5%");
    expect(percentLabel(0)).toBe("±0%");
    expect(percentLabel(null)).toBe("—");
    expect(deltaDirection(1)).toBe("up");
    expect(deltaDirection(-1)).toBe("down");
    expect(deltaDirection(0)).toBe("flat");
    expect(monthTitle("2026-09")).toBe("2026年9月");
  });
});
