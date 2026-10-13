import { beforeEach, describe, expect, it } from "vitest";
import { compareMonths, shiftMonth } from "../../src/core/compare";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const compare = (input: unknown) => compareMonths(db(), input, { now: NOW });

// 食費 = 食費グループ、娯楽 = 娯楽グループ(初期データ)
async function seed() {
  await addTransactions(
    db(),
    {
      transactions: [
        { date: "2026-09-03", amount: 3000, merchant: "ダミー食堂", category: "食費" },
        { date: "2026-09-25", amount: 2000, merchant: "ダミー食堂", category: "食費" },
        { date: "2026-09-10", amount: 1000, merchant: "ダミーシネマ", category: "娯楽" },
        { date: "2026-10-02", amount: 4000, merchant: "ダミー食堂", category: "食費" },
        { date: "2026-10-05", amount: 500, merchant: "ダミー商店", category: "日用品" },
        { date: "2025-10-04", amount: 1500, merchant: "ダミー食堂", category: "食費" },
      ],
    },
    { now: NOW },
  );
}

beforeEach(seed);

describe("shiftMonth", () => {
  it("月をまたいでずらす", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", -12)).toBe("2025-10");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("compareMonths", () => {
  it("既定は 今月(2026-10)と先月を、大分類ごとに比べる", async () => {
    const r = await compare({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ month: "2026-10", base_month: "2026-09", total: 4500, base_total: 6000, diff: -1500, diff_percent: -25, until_day: null });
    // 今月の金額の大きい順。片方の月にしかない項目も入る
    expect(r.rows.map((x) => [x.label, x.total, x.base_total, x.diff])).toEqual([
      ["食費", 4000, 5000, -1000],
      ["生活", 500, 0, 500],
      ["娯楽", 0, 1000, -1000],
    ]);
    expect(r.rows.find((x) => x.label === "生活")!.diff_percent).toBeNull();
    expect(r.message).toContain("-1,500円");
  });

  it("前年の同じ月・好きな月と比べる。同じ月はエラー", async () => {
    const y = await compare({ month: "2026-10", base: "year_ago" });
    expect(y.ok && y).toMatchObject({ base_month: "2025-10", base_total: 1500, diff: 3000, diff_percent: 200 });
    const c = await compare({ month: "2026-10", base: "2026-09" });
    expect(c.ok && c.base_month).toBe("2026-09");
    expect((await compare({ month: "2026-10", base: "2026-10" })).ok).toBe(false);
  });

  it("until_day で、どちらも同じ日までにそろえる(月末を超える日は月末まで)", async () => {
    const r = await compare({ month: "2026-10", until_day: 5 });
    expect(r.ok && r).toMatchObject({ total: 4500, base_total: 3000, until_day: 5, period: { from: "2026-10-01", to: "2026-10-05" }, base_period: { from: "2026-09-01", to: "2026-09-05" } });
    const feb = await compare({ month: "2026-03", base: "previous", until_day: 31 });
    expect(feb.ok && feb.base_period.to).toBe("2026-02-28");
  });

  it("カテゴリ単位でも比べられる。入力エラー", async () => {
    const r = await compare({ month: "2026-10", group_by: "category" });
    expect(r.ok && r.rows.map((x) => x.label)).toEqual(["食費", "日用品", "娯楽"]);
    expect((await compare({ month: "2026-13" })).ok).toBe(false);
    expect((await compare({ base: "last" })).ok).toBe(false);
    expect((await compare({ until_day: 0 })).ok).toBe(false);
    expect((await compare({ extra: 1 })).ok).toBe(false);
  });

  it("比べる月が空なら diff_percent は null", async () => {
    const r = await compare({ month: "2026-10", base: "2024-01" });
    expect(r.ok && r).toMatchObject({ base_total: 0, diff_percent: null });
  });
});
