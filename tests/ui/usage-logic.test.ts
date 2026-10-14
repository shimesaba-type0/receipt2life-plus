import { describe, expect, it } from "vitest";
import type { UsageDayView, UsageMeterView } from "../../src/api/contract";
import { parseRoute } from "../../ui/src/route";
import { barWidth, compactCount, dayBars, homeNotice, limitLine, meterText, percentText, shortDay } from "../../ui/src/pages/usageLogic";

const day = (date: string, rows_written: number): UsageDayView => ({ date, rows_read: 0, rows_written, read_queries: 0, write_queries: 0 });
const meter = (used: number, limit: number): UsageMeterView => ({ used, limit, ratio: used / limit, level: used / limit >= 0.9 ? "danger" : used / limit >= 0.7 ? "warn" : "ok" });

describe("使用量ページの純粋な部分", () => {
  it("ルートは /usage", () => {
    expect(parseRoute("/usage")).toEqual({ name: "usage" });
    expect(parseRoute("/usage/")).toEqual({ name: "usage" });
  });

  it("割合・棒の幅・件数の表示", () => {
    expect(percentText(0.1234)).toBe("12.3%");
    expect(percentText(0)).toBe("0%");
    expect(percentText(1.5)).toBe("150%");
    expect(barWidth(0)).toBe(0);
    expect(barWidth(0.001)).toBe(1.5);
    expect(barWidth(0.5)).toBe(50);
    expect(barWidth(3)).toBe(100);
    expect(compactCount(950)).toBe("950");
    expect(compactCount(12_300)).toBe("1.2万");
    expect(compactCount(5_000_000)).toBe("500万");
    expect(meterText({ used: 40_000, limit: 100_000 })).toBe("4万 / 10万");
  });

  it("日ごとの棒: 上限と最大値の大きいほうを100%にする。上限に届いた日は over", () => {
    const days = [day("2026-10-12", 0), day("2026-10-13", 50_000), day("2026-10-14", 100_000)];
    const bars = dayBars(days, (d) => d.rows_written, 100_000);
    expect(bars.map((b) => b.height)).toEqual([0, 50, 100]);
    expect(bars.map((b) => b.over)).toEqual([false, false, true]);
    expect(limitLine(days, (d) => d.rows_written, 100_000)).toBe(100);
    // 上限を超えた日があれば、その日が100%で、上限の線は下がる
    const over = [day("2026-10-14", 200_000)];
    expect(dayBars(over, (d) => d.rows_written, 100_000)[0]!.height).toBe(100);
    expect(limitLine(over, (d) => d.rows_written, 100_000)).toBe(50);
  });

  it("日付の短縮と、ホームの注意(余裕があるときは出さない)", () => {
    expect(shortDay("2026-10-14")).toBe("10/14");
    expect(shortDay("x")).toBe("x");
    expect(homeNotice("ok", meter(1, 100), meter(1, 100))).toBeNull();
    expect(homeNotice("warn", meter(50, 100), meter(75, 100))).toBe("D1 の今日の使用量が、増えています(書いた行が上限の 75%)");
    expect(homeNotice("danger", meter(95, 100), meter(10, 100))).toBe("D1 の今日の使用量が、上限に近づいています(読んだ行が上限の 95%)");
  });
});
