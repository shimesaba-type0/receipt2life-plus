import { describe, expect, it } from "vitest";
import {
  buildMonthGrid,
  defaultSelectedDate,
  eventEnd,
  formatCellAmount,
  formatPeriodShort,
  layoutWeekBands,
  laneCount,
  txSubline,
} from "../../ui/src/calendar-layout";

const ev = (id: string, start: string, end: string | null = null) => ({
  id,
  start_date: start,
  end_date: end,
  title: id,
  note: null,
  color: "red" as const,
});

describe("buildMonthGrid", () => {
  it("日曜始まりで、前後月の日を埋める(2026-10)", () => {
    const grid = buildMonthGrid("2026-10");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid[0]?.[0]).toBe("2026-09-27");
    expect(grid[0]?.[4]).toBe("2026-10-01");
    expect(grid.at(-1)?.[6]).toBe("2026-10-31");
    expect(grid).toHaveLength(5);
  });
  it("うるう年の2月(2024-02)は29日まで", () => {
    const flat = buildMonthGrid("2024-02").flat();
    expect(flat).toContain("2024-02-29");
    expect(flat).not.toContain("2024-02-30");
    expect(flat[0]).toBe("2024-01-28");
  });
  it("平年の2月で1日が日曜なら4週(2026-02)", () => {
    const grid = buildMonthGrid("2026-02");
    expect(grid).toHaveLength(4);
    expect(grid[0]?.[0]).toBe("2026-02-01");
    expect(grid[3]?.[6]).toBe("2026-02-28");
  });
  it("6週になる月と、年またぎ(2027-01 の前月は2026-12)", () => {
    expect(buildMonthGrid("2026-08")).toHaveLength(6);
    const jan = buildMonthGrid("2027-01");
    expect(jan[0]?.[0]).toBe("2026-12-27");
  });
});

describe("eventEnd", () => {
  it("end_date が無ければ1日間", () => {
    expect(eventEnd(ev("a", "2026-10-05"))).toBe("2026-10-05");
    expect(eventEnd(ev("a", "2026-10-05", "2026-10-07"))).toBe("2026-10-07");
  });
});

describe("layoutWeekBands", () => {
  const week = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];

  it("1日間の出来事は1列の帯", () => {
    const [b] = layoutWeekBands(week, [ev("a", "2026-10-06")]);
    expect(b).toMatchObject({ startCol: 2, endCol: 2, lane: 0, continuesBefore: false, continuesAfter: false });
  });
  it("週をまたぐ帯は週ごとに切り、続きの印をつける", () => {
    const e = ev("a", "2026-10-08", "2026-10-14");
    const w1 = layoutWeekBands(week, [e]);
    expect(w1[0]).toMatchObject({ startCol: 4, endCol: 6, continuesBefore: false, continuesAfter: true });
    const next = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
    const w2 = layoutWeekBands(next, [e]);
    expect(w2[0]).toMatchObject({ startCol: 0, endCol: 3, continuesBefore: true, continuesAfter: false });
  });
  it("その週と重ならない出来事は出さない", () => {
    expect(layoutWeekBands(week, [ev("a", "2026-09-01", "2026-09-30"), ev("b", "2026-10-11")])).toEqual([]);
  });
  it("月またぎの出来事が、前月側の表示日にも出る", () => {
    const w = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"];
    const [b] = layoutWeekBands(w, [ev("a", "2026-09-29", "2026-10-02")]);
    expect(b).toMatchObject({ startCol: 2, endCol: 5 });
  });
  it("重ならないものは同じレーン、重なるものは別レーン", () => {
    const bands = layoutWeekBands(week, [ev("a", "2026-10-04", "2026-10-05"), ev("b", "2026-10-06", "2026-10-07"), ev("c", "2026-10-05", "2026-10-06")]);
    const lane = (id: string) => bands.find((b) => b.event.id === id)?.lane;
    expect(lane("a")).toBe(0);
    expect(lane("b")).toBe(0);
    expect(lane("c")).toBe(1);
    expect(laneCount(bands)).toBe(2);
  });
  it("3つ重なると3レーン", () => {
    const bands = layoutWeekBands(week, [ev("a", "2026-10-04", "2026-10-10"), ev("b", "2026-10-05", "2026-10-09"), ev("c", "2026-10-06")]);
    expect(bands.map((b) => b.lane).sort()).toEqual([0, 1, 2]);
    expect(laneCount(bands)).toBe(3);
  });
  it("同じ開始なら長い帯が上(レーンが若い)", () => {
    const bands = layoutWeekBands(week, [ev("short", "2026-10-04"), ev("long", "2026-10-04", "2026-10-08")]);
    expect(bands.find((b) => b.event.id === "long")?.lane).toBe(0);
  });
  it("帯が無ければレーン数は0", () => {
    expect(laneCount([])).toBe(0);
  });
});

describe("formatPeriodShort", () => {
  it("1日だけなら M/D", () => {
    expect(formatPeriodShort("2026-10-07", null)).toBe("10/7");
    expect(formatPeriodShort("2026-10-07", "2026-10-07")).toBe("10/7");
  });
  it("期間は M/D〜M/D(0埋めしない)", () => {
    expect(formatPeriodShort("2026-10-03", "2026-10-05")).toBe("10/3〜10/5");
    expect(formatPeriodShort("2026-10-30", "2026-11-02")).toBe("10/30〜11/2");
  });
  it("終了が開始より前なら1日として扱う", () => {
    expect(formatPeriodShort("2026-10-07", "2026-10-01")).toBe("10/7");
  });
});

describe("formatCellAmount", () => {
  it("¥なしの桁区切り、0や未定義は空", () => {
    expect(formatCellAmount(2310)).toBe("2,310");
    expect(formatCellAmount(1234567)).toBe("1,234,567");
    expect(formatCellAmount(0)).toBe("");
    expect(formatCellAmount(undefined)).toBe("");
  });
});

describe("defaultSelectedDate", () => {
  it("今日がその月なら今日、違えば月初", () => {
    expect(defaultSelectedDate("2026-10", "2026-10-11")).toBe("2026-10-11");
    expect(defaultSelectedDate("2026-09", "2026-10-11")).toBe("2026-09-01");
  });
});

describe("txSubline", () => {
  it("カテゴリと口座を「・」でつなぐ。無ければ省く", () => {
    expect(txSubline({ category: "食費", account: "現金" })).toBe("食費・現金");
    expect(txSubline({ category: "食費", account: null })).toBe("食費");
    expect(txSubline({ category: null, account: null })).toBe("");
  });
});
