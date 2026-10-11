import { describe, expect, it } from "vitest";
import { summarize } from "../../src/core/summarize";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const ts = NOW.toISOString();
let seq = 0;

async function tx(date: string, amount: number, merchant: string | null, categoryId: string | null) {
  seq += 1;
  await db()
    .prepare(
      `INSERT INTO transactions (id, date, amount, merchant, category_id, source, status, dedup_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', 'ok', ?, ?, ?)`,
    )
    .bind(`t${seq}`, date, amount, merchant, categoryId, `h${seq}`, ts, ts)
    .run();
}

async function event(id: string, title: string, start: string, end: string | null) {
  await db()
    .prepare(`INSERT INTO events (id, start_date, end_date, title, color, created_at, updated_at) VALUES (?, ?, ?, ?, 'blue', ?, ?)`)
    .bind(id, start, end, title, ts, ts)
    .run();
}

async function seed() {
  await tx("2026-09-30", 1000, "A店", "cat_food");
  await tx("2026-10-01", 6000, "A店", "cat_food");
  await tx("2026-10-02", 2500, "B店", "cat_daily");
  await tx("2026-10-03", 1500, null, null);
}

describe("summarize", () => {
  it("category: 金額の降順、カテゴリなしは(未分類)、割合は小数第1位", async () => {
    await seed();
    const res = await summarize(db(), { group_by: "category" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.total).toBe(11000);
    expect(res.count).toBe(4);
    expect(res.from).toBeNull();
    expect(res.rows).toEqual([
      { key: "食費", label: "食費", count: 2, total: 7000, percent: 63.6 },
      { key: "日用品", label: "日用品", count: 1, total: 2500, percent: 22.7 },
      { key: "(未分類)", label: "(未分類)", count: 1, total: 1500, percent: 13.6 },
    ]);
    expect(res.message).toContain("全期間: 4件 合計11,000円");
    expect(res.message).toContain("食費 63.6%");
    expect(res.message).toContain("記録した範囲");
  });

  it("同額は key の昇順", async () => {
    await tx("2026-10-01", 1000, "B店", null);
    await tx("2026-10-01", 1000, "A店", null);
    const res = await summarize(db(), { group_by: "merchant" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows.map((r) => r.key)).toEqual(["A店", "B店"]);
  });

  it("group: カテゴリの大分類で束ねる", async () => {
    await seed();
    await tx("2026-10-04", 500, "C店", "cat_transport");
    const res = await summarize(db(), { group_by: "group" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows.map((r) => [r.key, r.total])).toEqual([
      ["食費", 7000],
      ["生活", 2500],
      ["(未分類)", 1500],
      ["交通", 500],
    ]);
  });

  it("month: 昇順で、キーは YYYY-MM", async () => {
    await seed();
    const res = await summarize(db(), { group_by: "month" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows.map((r) => [r.key, r.count, r.total])).toEqual([
      ["2026-09", 1, 1000],
      ["2026-10", 3, 10000],
    ]);
  });

  it("merchant: 店名なしは(店名なし)、正規化はしない", async () => {
    await seed();
    await tx("2026-10-05", 300, "a店", null);
    const res = await summarize(db(), { group_by: "merchant" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows.map((r) => [r.key, r.total])).toEqual([
      ["A店", 7000],
      ["B店", 2500],
      ["(店名なし)", 1500],
      ["a店", 300],
    ]);
  });

  it("期間で絞り込む(両端を含む)。from だけ、to だけも使える", async () => {
    await seed();
    const both = await summarize(db(), { from: "2026-10-01", to: "2026-10-02", group_by: "category" });
    if (!both.ok) throw new Error("failed");
    expect(both.total).toBe(8500);
    expect(both.count).toBe(2);
    expect(both.message).toContain("2026-10-01〜2026-10-02: 2件 合計8,500円");

    const fromOnly = await summarize(db(), { from: "2026-10-02", group_by: "month" });
    if (!fromOnly.ok) throw new Error("failed");
    expect(fromOnly.total).toBe(4000);
    const toOnly = await summarize(db(), { to: "2026-09-30", group_by: "month" });
    if (!toOnly.ok) throw new Error("failed");
    expect(toOnly.total).toBe(1000);
  });

  it("空の期間は合計0、行なし", async () => {
    await seed();
    const res = await summarize(db(), { from: "2026-01-01", to: "2026-01-31", group_by: "category" });
    expect(res).toMatchObject({ ok: true, total: 0, count: 0, rows: [] });
    if (res.ok) expect(res.message).toContain("記録された支出はありません");
  });

  it("event_id: 期間・単日の出来事に数え、重複して入る取引はそれぞれに数える。どこにも入らないものは(出来事なし)", async () => {
    await seed();
    await event("ev_trip", "出張", "2026-10-01", "2026-10-02");
    await event("ev_day", "誕生日", "2026-10-02", null);
    const res = await summarize(db(), { group_by: "event_id" });
    if (!res.ok) throw new Error("failed");
    expect(res.total).toBe(11000);
    expect(res.rows).toEqual([
      { key: "ev_trip", label: "出張", count: 2, total: 8500, percent: 77.3 },
      { key: "(出来事なし)", label: "(出来事なし)", count: 2, total: 2500, percent: 22.7 },
      { key: "ev_day", label: "誕生日", count: 1, total: 2500, percent: 22.7 },
    ]);
    // 2500円の取引は出張と誕生日の両方に入るので、行の合計は total を超える
    expect(res.rows.reduce((s, r) => s + r.total, 0)).toBeGreaterThan(res.total);
    expect(res.message).toContain("それぞれに数える");
  });

  it("event_id: 期間で絞ると、その期間の取引だけを数える", async () => {
    await seed();
    await event("ev_trip", "出張", "2026-09-29", "2026-10-02");
    const res = await summarize(db(), { from: "2026-10-03", group_by: "event_id" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows).toEqual([{ key: "(出来事なし)", label: "(出来事なし)", count: 1, total: 1500, percent: 100 }]);
  });

  it("event_id: 取引がなければ行なし", async () => {
    await event("ev_trip", "出張", "2026-10-01", null);
    const res = await summarize(db(), { group_by: "event_id" });
    expect(res).toMatchObject({ ok: true, total: 0, rows: [] });
  });

  it("割合の丸め: 3等分は 33.3 %", async () => {
    await tx("2026-10-01", 100, "A", "cat_food");
    await tx("2026-10-01", 100, "B", "cat_daily");
    await tx("2026-10-01", 100, "C", "cat_leisure");
    const res = await summarize(db(), { group_by: "category" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows.map((r) => r.percent)).toEqual([33.3, 33.3, 33.3]);
  });

  it("from が to より後ならエラー", async () => {
    const res = await summarize(db(), { from: "2026-10-31", to: "2026-10-01", group_by: "category" });
    expect(res).toEqual({ ok: false, errors: [{ field: "from", message: expect.stringContaining("to 以前") }] });
  });

  it("group_by の未指定・未知の値はエラー", async () => {
    const missing = await summarize(db(), {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]).toMatchObject({ field: "group_by", message: expect.stringContaining("event_id") });
    const unknown = await summarize(db(), { group_by: "account" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.field).toBe("group_by");
  });

  it("不正な日付と未知の項目はエラー", async () => {
    const res = await summarize(db(), { from: "2026-02-30", group_by: "month", foo: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.field).sort()).toEqual(["foo", "from"]);
  });
});
