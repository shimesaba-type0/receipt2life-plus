import { describe, expect, it } from "vitest";
import { MAX_YEAR, MIN_YEAR, clampYear, isValidDate, monthButtons, monthHref, parseYear, shiftYear } from "../../ui/src/month-picker";

describe("clampYear / shiftYear", () => {
  it("範囲内に収める", () => {
    expect(clampYear(2026)).toBe(2026);
    expect(clampYear(MIN_YEAR - 5)).toBe(MIN_YEAR);
    expect(clampYear(MAX_YEAR + 5)).toBe(MAX_YEAR);
    expect(clampYear(Number.NaN)).toBe(MIN_YEAR);
  });
  it("年を前後に動かし、端で止まる", () => {
    expect(shiftYear(2026, 1)).toBe(2027);
    expect(shiftYear(2026, -1)).toBe(2025);
    expect(shiftYear(MIN_YEAR, -1)).toBe(MIN_YEAR);
    expect(shiftYear(MAX_YEAR, 1)).toBe(MAX_YEAR);
  });
});

describe("parseYear", () => {
  it("YYYY-MM から年を取り出す(範囲内に収める)", () => {
    expect(parseYear("2026-10")).toBe(2026);
    expect(parseYear("1850-01")).toBe(MIN_YEAR);
    expect(parseYear("garbage")).toBe(MIN_YEAR);
  });
});

describe("monthButtons", () => {
  it("12か月分を作り、選択中と今月を示す", () => {
    const list = monthButtons(2026, "2026-10", "2026-10");
    expect(list).toHaveLength(12);
    expect(list[0]).toMatchObject({ month: "2026-01", label: "1月", current: false, selected: false });
    expect(list[9]).toMatchObject({ month: "2026-10", label: "10月", current: true, selected: true });
  });
  it("別の年では今月・選択が付かない", () => {
    expect(monthButtons(2025, "2026-10", "2026-10").some((b) => b.current || b.selected)).toBe(false);
  });
});

describe("monthHref", () => {
  it("カレンダーの月URL", () => {
    expect(monthHref("2027-03")).toBe("/calendar?month=2027-03");
  });
});

describe("isValidDate", () => {
  it("実在する日付だけ通す", () => {
    expect(isValidDate("2026-10-11")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("")).toBe(false);
    expect(isValidDate("2026-1-1")).toBe(false);
  });
  it("対応する年の範囲外は通さない", () => {
    expect(isValidDate("1999-12-31")).toBe(false);
    expect(isValidDate("2100-01-01")).toBe(false);
  });
});
