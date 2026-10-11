import { describe, expect, it } from "vitest";
import { formatHolidayDate, holidayName, holidaysInMonth } from "../../ui/src/holidays";

function yearHolidays(y: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let m = 1; m <= 12; m++) {
    for (const h of holidaysInMonth(`${y}-${String(m).padStart(2, "0")}`)) out[h.date] = h.name;
  }
  return out;
}

describe("holidays 2026", () => {
  it("全祝日がちょうど18日出る", () => {
    expect(yearHolidays(2026)).toEqual({
      "2026-01-01": "元日",
      "2026-01-12": "成人の日",
      "2026-02-11": "建国記念の日",
      "2026-02-23": "天皇誕生日",
      "2026-03-20": "春分の日",
      "2026-04-29": "昭和の日",
      "2026-05-03": "憲法記念日",
      "2026-05-04": "みどりの日",
      "2026-05-05": "こどもの日",
      "2026-05-06": "振替休日",
      "2026-07-20": "海の日",
      "2026-08-11": "山の日",
      "2026-09-21": "敬老の日",
      "2026-09-22": "国民の休日",
      "2026-09-23": "秋分の日",
      "2026-10-12": "スポーツの日",
      "2026-11-03": "文化の日",
      "2026-11-23": "勤労感謝の日",
    });
  });

  it("月ごとの一覧は日付昇順", () => {
    expect(holidaysInMonth("2026-09")).toEqual([
      { date: "2026-09-21", name: "敬老の日" },
      { date: "2026-09-22", name: "国民の休日" },
      { date: "2026-09-23", name: "秋分の日" },
    ]);
    expect(holidaysInMonth("2026-06")).toEqual([]);
  });

  it("祝日でない日は null", () => {
    expect(holidayName("2026-01-02")).toBeNull();
    expect(holidayName("2026-09-24")).toBeNull();
    expect(holidayName("2026-02-30")).toBeNull();
    expect(holidayName("abc")).toBeNull();
    expect(holidayName("2026-10-13")).toBeNull();
  });
});

describe("holidays 2025 / 2024", () => {
  it("2025", () => {
    const h = yearHolidays(2025);
    expect(h["2025-02-24"]).toBe("振替休日");
    expect(h["2025-05-06"]).toBe("振替休日");
    expect(h["2025-11-24"]).toBe("振替休日");
    expect(h["2025-03-20"]).toBe("春分の日");
    expect(h["2025-09-23"]).toBe("秋分の日");
    expect(Object.values(h).filter((n) => n === "振替休日")).toHaveLength(3);
  });

  it("2024", () => {
    const h = yearHolidays(2024);
    for (const d of ["2024-02-12", "2024-05-06", "2024-08-12", "2024-09-23", "2024-11-04"]) expect(h[d]).toBe("振替休日");
    expect(Object.values(h).filter((n) => n === "振替休日")).toHaveLength(5);
    expect(h["2024-03-20"]).toBe("春分の日");
    expect(h["2024-09-22"]).toBe("秋分の日");
  });
});

describe("特例の年", () => {
  it("2020", () => {
    expect(holidayName("2020-07-23")).toBe("海の日");
    expect(holidayName("2020-07-24")).toBe("スポーツの日");
    expect(holidayName("2020-08-10")).toBe("山の日");
    expect(holidayName("2020-07-20")).toBeNull();
    expect(holidayName("2020-10-12")).toBeNull();
    expect(holidayName("2020-08-11")).toBeNull();
    expect(holidayName("2020-02-23")).toBe("天皇誕生日");
    expect(holidayName("2020-02-24")).toBe("振替休日");
  });

  it("2021", () => {
    expect(holidayName("2021-07-22")).toBe("海の日");
    expect(holidayName("2021-07-23")).toBe("スポーツの日");
    expect(holidayName("2021-08-08")).toBe("山の日");
    expect(holidayName("2021-08-09")).toBe("振替休日");
    expect(holidayName("2021-10-11")).toBeNull();
  });

  it("2019", () => {
    expect(holidayName("2019-04-30")).toBe("国民の休日");
    expect(holidayName("2019-05-01")).toBe("休日(天皇の即位の日)");
    expect(holidayName("2019-05-02")).toBe("国民の休日");
    expect(holidayName("2019-05-06")).toBe("振替休日");
    expect(holidayName("2019-10-22")).toBe("休日(即位礼正殿の儀)");
    expect(holidayName("2019-10-14")).toBe("体育の日");
    expect(holidayName("2019-12-23")).toBeNull();
    expect(holidayName("2019-02-23")).toBeNull();
  });

  it("天皇誕生日の移り変わり", () => {
    expect(holidayName("2018-12-23")).toBe("天皇誕生日");
    expect(holidayName("2018-12-24")).toBe("振替休日");
    expect(holidayName("2018-02-23")).toBeNull();
  });
});

describe("古い年", () => {
  it("2006年までは 5/4 が国民の休日、4/29 はみどりの日", () => {
    expect(holidayName("2005-05-04")).toBe("国民の休日");
    expect(holidayName("2005-04-29")).toBe("みどりの日");
    expect(holidayName("2007-04-29")).toBe("昭和の日");
    expect(holidayName("2007-05-04")).toBe("みどりの日");
  });

  it("ハッピーマンデーの開始年", () => {
    expect(holidayName("2000-01-10")).toBe("成人の日");
    expect(holidayName("2000-10-09")).toBe("体育の日");
    expect(holidayName("2002-07-20")).toBe("海の日");
    expect(holidayName("2003-07-21")).toBe("海の日");
    expect(holidayName("2002-09-15")).toBe("敬老の日");
    expect(holidayName("2003-09-15")).toBe("敬老の日");
    expect(holidayName("2009-09-22")).toBe("国民の休日");
  });

  it("山の日は 2016 年から", () => {
    expect(holidayName("2015-08-11")).toBeNull();
    expect(holidayName("2016-08-11")).toBe("山の日");
  });
});

describe("範囲外", () => {
  it("1999 と 2100 は null / 空", () => {
    expect(holidayName("1999-01-01")).toBeNull();
    expect(holidayName("2100-01-01")).toBeNull();
    expect(holidaysInMonth("1999-12")).toEqual([]);
    expect(holidaysInMonth("2100-01")).toEqual([]);
    expect(holidayName("2000-01-01")).toBe("元日");
    expect(holidayName("2099-01-01")).toBe("元日");
    expect(holidaysInMonth("2099-11").length).toBeGreaterThanOrEqual(1);
  });
});

describe("formatHolidayDate", () => {
  it("月/日(曜)", () => {
    expect(formatHolidayDate("2026-10-12")).toBe("10/12(月)");
    expect(formatHolidayDate("2026-05-03")).toBe("5/3(日)");
  });
});
