import { describe, expect, it } from "vitest";
import { addTransactions, listTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const add = (transactions: unknown[]) => addTransactions(testEnv().DB, { transactions }, { now: NOW });

describe("addTransactions", () => {
  it("取引を登録して、一覧つきのメッセージを返す", async () => {
    const res = await add([
      { date: "2026-10-11", amount: 1280, merchant: "A店", category: "食費", account: "現金", source: "receipt" },
      { date: "2026-10-11", amount: 540, merchant: "B店", category: "日用品", account: "カード", source: "receipt" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registered).toHaveLength(2);
    expect(res.message).toBe("2件登録しました: A店 1,280円 / B店 540円");
    expect(res.registered[0]).toMatchObject({ amount: 1280, category: "食費", account: "現金", status: "ok" });
  });

  it("必須は金額だけ。date省略は今日(JST)、不完全なものは needs_review", async () => {
    const res = await add([{ amount: 800 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registered[0]).toMatchObject({
      date: "2026-10-11",
      amount: 800,
      merchant: null,
      category: null,
      source: "manual",
      status: "needs_review",
    });
  });

  it("金額が整数でなければ、項目名つきの文章でエラーを返す", async () => {
    const res = await add([{ amount: 12.5, merchant: "A店", category: "食費" }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).toEqual([{ index: 0, field: "amount", message: expect.stringContaining("整数") }]);
  });

  it("未来日付・極端な金額・不正な日付を拒否する", async () => {
    const res = await add([
      { date: "2026-10-12", amount: 100 },
      { amount: 100_000_000 },
      { date: "2026-02-30", amount: 100 },
      { date: "2026/10/01", amount: 100 },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => [e.index, e.field])).toEqual([
      [0, "date"],
      [1, "amount"],
      [2, "date"],
      [3, "date"],
    ]);
  });

  it("未知のカテゴリ・口座は、選べる値を示してエラーにする", async () => {
    const res = await add([{ amount: 100, category: "食事", account: "小切手" }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ index: 0, field: "category" });
    expect(res.errors[0]?.message).toContain("食費");
    expect(res.errors[1]).toMatchObject({ index: 0, field: "account" });
    expect(res.errors[1]?.message).toContain("現金");
  });

  it("未知の項目名(打ち間違い)もエラーにする", async () => {
    const res = await add([{ amount: 100, store: "A店" }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ index: 0, field: "store" });
  });

  it("1件でもエラーなら、1件も登録しない", async () => {
    const res = await add([{ amount: 100, merchant: "A店" }, { amount: -5 }]);
    expect(res.ok).toBe(false);
    const list = await listTransactions(testEnv().DB, {});
    expect(list.ok && list.transactions).toEqual([]);
  });

  it("重複(同日・同額・同じ店)は登録せず、既存IDを返して警告する", async () => {
    const first = await add([{ date: "2026-10-11", amount: 1280, merchant: "A店" }]);
    if (!first.ok) throw new Error("setup failed");
    const second = await add([
      { date: "2026-10-11", amount: 1280, merchant: " Ａ店 " },
      { date: "2026-10-11", amount: 300, merchant: "C店" },
    ]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.registered).toHaveLength(1);
    expect(second.skipped_duplicates).toEqual([{ index: 0, existing_id: first.registered[0]?.id }]);
    expect(second.message).toContain("重複");
  });

  it("allow_duplicate:true なら強制登録できる", async () => {
    await add([{ date: "2026-10-11", amount: 1280, merchant: "A店" }]);
    const res = await add([{ date: "2026-10-11", amount: 1280, merchant: "A店", allow_duplicate: true }]);
    expect(res.ok && res.registered).toHaveLength(1);
  });

  it("同じ配列内の重複も、後のものを重複として扱う", async () => {
    const res = await add([
      { date: "2026-10-11", amount: 100, merchant: "A店" },
      { date: "2026-10-11", amount: 100, merchant: "A店" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registered).toHaveLength(1);
    expect(res.skipped_duplicates).toEqual([{ index: 1, duplicate_of_index: 0 }]);
  });
});

describe("listTransactions", () => {
  async function seed() {
    await add([
      { date: "2026-10-01", amount: 100, merchant: "A", category: "食費" },
      { date: "2026-10-05", amount: 200, merchant: "B", category: "日用品" },
      { date: "2026-10-10", amount: 300, merchant: "C", category: "食費" },
    ]);
  }

  it("日付の新しい順で返す", async () => {
    await seed();
    const res = await listTransactions(testEnv().DB, {});
    expect(res.ok && res.transactions.map((t) => t.merchant)).toEqual(["C", "B", "A"]);
  });

  it("from / to / category で絞り込める", async () => {
    await seed();
    const res = await listTransactions(testEnv().DB, { from: "2026-10-02", to: "2026-10-10", category: "食費" });
    expect(res.ok && res.transactions.map((t) => t.merchant)).toEqual(["C"]);
  });

  it("from が to より後ならエラー", async () => {
    const res = await listTransactions(testEnv().DB, { from: "2026-10-10", to: "2026-10-01" });
    expect(res.ok).toBe(false);
  });

  it("未知のカテゴリはエラー", async () => {
    const res = await listTransactions(testEnv().DB, { category: "なぞ" });
    expect(res.ok).toBe(false);
  });
});
