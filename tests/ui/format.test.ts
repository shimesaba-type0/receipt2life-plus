import { describe, expect, it } from "vitest";
import { addMonths, formatDateJa, formatMonthJa, formatYen, monthOf, monthRange, todayJst, weekdayIndex } from "../../ui/src/format";

describe("format", () => {
  it("金額", () => {
    expect(formatYen(2580)).toBe("¥2,580");
    expect(formatYen(0)).toBe("¥0");
  });
  it("日付(曜日つき)", () => {
    expect(formatDateJa("2026-10-11")).toBe("2026年10月11日(日)");
    expect(formatDateJa("2026-01-01")).toBe("2026年1月1日(木)");
    expect(weekdayIndex("2026-10-01")).toBe(4);
  });
  it("月", () => {
    expect(formatMonthJa("2026-10")).toBe("2026年10月");
    expect(monthOf("2026-10-11")).toBe("2026-10");
  });
  it("月を前後に動かす(年をまたぐ)", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
  });
  it("月の範囲(うるう年を含む)", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("今日(JST)は、UTCの日付が変わる前でも日本の日付", () => {
    expect(todayJst(new Date("2026-10-10T16:00:00Z"))).toBe("2026-10-11");
  });
});
