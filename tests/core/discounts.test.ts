import { describe, expect, it } from "vitest";
import { summarizeDiscounts } from "../../src/core/discounts";
import { summarize, summarizeForTool } from "../../src/core/summarize";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const ts = NOW.toISOString();
let seq = 0;

async function tx(date: string, amount: number, merchant: string | null, categoryId: string | null): Promise<string> {
  seq += 1;
  const id = `t${seq}`;
  await db()
    .prepare(
      `INSERT INTO transactions (id, date, amount, merchant, category_id, source, status, dedup_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'manual', 'ok', ?, ?, ?)`,
    )
    .bind(id, date, amount, merchant, categoryId, `h${seq}`, ts, ts)
    .run();
  return id;
}

async function item(txId: string, position: number, name: string, amount: number, categoryId: string | null = null) {
  await db()
    .prepare(`INSERT INTO transaction_items (id, transaction_id, position, name, amount, category_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(`i${txId}-${position}`, txId, position, name, amount, categoryId, ts)
    .run();
}

// 取引の amount は明細の合計。ダミーの店・品名だけ
async function seed() {
  // A店 10/01: 1000 + 500 - 100(値引き、食費) - 50(クーポン、カテゴリ指定なし → 取引の食費) = 1350
  const t1 = await tx("2026-10-01", 1350, "A店", "cat_food");
  await item(t1, 0, "品A", 1000);
  await item(t1, 1, "品B", 500);
  await item(t1, 2, "値引", -100, "cat_food");
  await item(t1, 3, "クーポン", -50);
  // B店 10/02: 800 + 300 - 200(割引、日用品) = 900
  const t2 = await tx("2026-10-02", 900, "B店", "cat_food");
  await item(t2, 0, "品C", 800, "cat_food");
  await item(t2, 1, "品D", 300, "cat_daily");
  await item(t2, 2, "割引", -200, "cat_daily");
  // 店名なし 9/30: 600 - 60 = 540、カテゴリなし
  const t3 = await tx("2026-09-30", 540, null, null);
  await item(t3, 0, "品E", 600);
  await item(t3, 1, "割引", -60);
  // 明細なし(割引なし)
  await tx("2026-10-03", 2000, "C店", "cat_daily");
}

describe("summarizeDiscounts", () => {
  it("合計は正の円、行数・レシート数・支出の合計(summarize と同じ定義)", async () => {
    await seed();
    const res = await summarizeDiscounts(db(), {});
    if (!res.ok) throw new Error("failed");
    expect(res).toMatchObject({ group_by: "none", from: null, to: null, total: 410, line_count: 4, receipt_count: 3, spend_total: 4790, rows: [] });
    expect(res.total).toBeGreaterThan(0);
    const base = await summarize(db(), { group_by: "month" });
    if (!base.ok) throw new Error("failed");
    expect(res.spend_total).toBe(base.total);
    expect(res.message).toContain("410円");
    expect(res.message).toContain("印字");
  });

  it("期間で絞る(両端を含む)", async () => {
    await seed();
    const res = await summarizeDiscounts(db(), { from: "2026-10-01", to: "2026-10-31" });
    if (!res.ok) throw new Error("failed");
    expect(res).toMatchObject({ from: "2026-10-01", to: "2026-10-31", total: 350, line_count: 3, receipt_count: 2, spend_total: 4250 });
    const one = await summarizeDiscounts(db(), { from: "2026-10-02", to: "2026-10-02" });
    if (!one.ok) throw new Error("failed");
    expect(one).toMatchObject({ total: 200, line_count: 1, receipt_count: 1 });
  });

  it("割引がなければ0(rows も空)", async () => {
    await tx("2026-10-01", 500, "A店", "cat_food");
    const res = await summarizeDiscounts(db(), { group_by: "merchant" });
    if (!res.ok) throw new Error("failed");
    expect(res).toMatchObject({ total: 0, line_count: 0, receipt_count: 0, spend_total: 500, rows: [] });
    const empty = await summarizeDiscounts(db(), {});
    if (!empty.ok) throw new Error("failed");
    expect(empty).toMatchObject({ total: 0, spend_total: 500 });
  });

  it("データがまったくなくても0", async () => {
    const res = await summarizeDiscounts(db(), { from: "2026-10-01", to: "2026-10-31" });
    if (!res.ok) throw new Error("failed");
    expect(res).toMatchObject({ total: 0, line_count: 0, receipt_count: 0, spend_total: 0 });
  });

  it("明細のない取引は、金額がマイナスでも割引に数えない", async () => {
    await seed();
    await tx("2026-10-04", -700, "返品店", "cat_daily");
    const res = await summarizeDiscounts(db(), {});
    if (!res.ok) throw new Error("failed");
    expect(res).toMatchObject({ total: 410, line_count: 4, receipt_count: 3 });
  });

  it("merchant: 合計の大きい順、店名なしは(店名なし)", async () => {
    await seed();
    const res = await summarizeDiscounts(db(), { group_by: "merchant" });
    if (!res.ok) throw new Error("failed");
    expect(res.group_by).toBe("merchant");
    expect(res.rows).toEqual([
      { key: "B店", total: 200, line_count: 1, receipt_count: 1 },
      { key: "A店", total: 150, line_count: 2, receipt_count: 1 },
      { key: "(店名なし)", total: 60, line_count: 1, receipt_count: 1 },
    ]);
    expect(res.rows.reduce((s, r) => s + r.total, 0)).toBe(res.total);
  });

  it("category: 実効カテゴリ(行のカテゴリ、なければ取引のカテゴリ)。どちらもなければ(未分類)", async () => {
    await seed();
    const res = await summarizeDiscounts(db(), { group_by: "category" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows).toEqual([
      { key: "日用品", total: 200, line_count: 1, receipt_count: 1 },
      { key: "食費", total: 150, line_count: 2, receipt_count: 1 },
      { key: "(未分類)", total: 60, line_count: 1, receipt_count: 1 },
    ]);
  });

  it("month: 月の古い順", async () => {
    await seed();
    const res = await summarizeDiscounts(db(), { group_by: "month" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows).toEqual([
      { key: "2026-09", total: 60, line_count: 1, receipt_count: 1 },
      { key: "2026-10", total: 350, line_count: 3, receipt_count: 2 },
    ]);
  });

  it("同額は key の昇順", async () => {
    const a = await tx("2026-10-01", 900, "B店", null);
    await item(a, 0, "品", 1000);
    await item(a, 1, "割引", -100);
    const b = await tx("2026-10-01", 900, "A店", null);
    await item(b, 0, "品", 1000);
    await item(b, 1, "割引", -100);
    const res = await summarizeDiscounts(db(), { group_by: "merchant" });
    if (!res.ok) throw new Error("failed");
    expect(res.rows.map((r) => r.key)).toEqual(["A店", "B店"]);
  });

  it("1レシートに割引の行が複数あっても、レシート数は1", async () => {
    const t = await tx("2026-10-01", 700, "A店", null);
    await item(t, 0, "品", 1000);
    await item(t, 1, "割引1", -200);
    await item(t, 2, "割引2", -100);
    const res = await summarizeDiscounts(db(), {});
    if (!res.ok) throw new Error("failed");
    expect(res).toMatchObject({ total: 300, line_count: 2, receipt_count: 1 });
  });

  it("入力エラー: from > to、不正な group_by、未知のキー、不正な日付", async () => {
    const a = await summarizeDiscounts(db(), { from: "2026-10-31", to: "2026-10-01" });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors[0]?.field).toBe("from");
    const b = await summarizeDiscounts(db(), { group_by: "group" });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors[0]?.message).toContain("none");
    expect((await summarizeDiscounts(db(), { foo: 1 })).ok).toBe(false);
    expect((await summarizeDiscounts(db(), { from: "2026-13-01" })).ok).toBe(false);
  });
});

describe("summarizeForTool(MCP の summarize)", () => {
  it("discounts_only: true は割引の集計を返す。group_by は省略できる", async () => {
    await seed();
    const res = await summarizeForTool(db(), { discounts_only: true });
    if (!res.ok) throw new Error("failed");
    expect(res).toMatchObject({ total: 410, group_by: "none" });
    const byMerchant = await summarizeForTool(db(), { discounts_only: true, group_by: "merchant" });
    if (!byMerchant.ok || !("line_count" in byMerchant)) throw new Error("failed");
    expect(byMerchant.rows[0]).toMatchObject({ key: "B店", total: 200 });
  });

  it("discounts_only: true で割引にない group_by はエラー", async () => {
    const res = await summarizeForTool(db(), { discounts_only: true, group_by: "event_id" });
    expect(res.ok).toBe(false);
  });

  it("discounts_only なし(または false)は従来の summarize と同じ。group_by が無ければ従来のエラー", async () => {
    await seed();
    const a = await summarizeForTool(db(), { group_by: "month" });
    const b = await summarize(db(), { group_by: "month" });
    expect(a).toEqual(b);
    const c = await summarizeForTool(db(), { group_by: "month", discounts_only: false });
    expect(c).toEqual(b);
    const d = await summarizeForTool(db(), {});
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.errors[0]?.message).toContain("group_by");
    expect((await summarizeForTool(db(), { group_by: "none" })).ok).toBe(false);
  });
});
