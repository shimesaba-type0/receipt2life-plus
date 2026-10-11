import { describe, expect, it } from "vitest";
import { deleteCategory, listCategories } from "../../src/core/categories";
import { getHome } from "../../src/core/home";
import { getDay } from "../../src/core/calendar";
import { summarize } from "../../src/core/summarize";
import { GROUP_BYS } from "../../src/core/report-schema";
import { addTransactions, deleteTransaction, getTransaction, listTransactions, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// 明細(transaction_items)の core のテスト。店名・品名はすべてダミー
const db = () => testEnv().DB;
const add = (transactions: unknown[]) => addTransactions(db(), { transactions }, { now: NOW });
const update = (input: unknown) => updateTransaction(db(), input, { now: NOW });

async function addOne(tx: Record<string, unknown>) {
  const res = await add([{ date: "2026-10-10", ...tx }]);
  if (!res.ok) throw new Error(`add failed: ${JSON.stringify(res.errors)}`);
  return res.registered[0]!;
}

const count = async (sql: string, ...binds: unknown[]) => (await db().prepare(sql).bind(...binds).first<{ n: number }>())!.n;

describe("add_transactions の明細", () => {
  it("明細を行ごとに登録し、並び順(position)・行のカテゴリ(実効ではない値)を返す", async () => {
    const tx = await addOne({
      amount: 1030,
      merchant: "Aストア",
      category: "食費",
      items: [
        { name: "牛乳", amount: 250 },
        { name: "パン", amount: 330 },
        { name: "洗剤", amount: 500, category: "日用品", memo: "詰め替え" },
        { name: "値引", amount: -50 },
      ],
    });
    expect(tx.status).toBe("ok");
    expect(tx.items.map((i) => [i.position, i.name, i.amount, i.category, i.tax_flag, i.memo])).toEqual([
      [0, "牛乳", 250, null, null, null],
      [1, "パン", 330, null, null, null],
      [2, "洗剤", 500, "日用品", null, "詰め替え"],
      [3, "値引", -50, null, null, null],
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM transaction_items WHERE transaction_id = ?", tx.id)).toBe(4);
    // 一覧でも同じ明細が返る
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions[0]!.items).toEqual(tx.items);
  });

  it("明細の合計が金額と合わなければ、差額を日本語で示して全体を拒否する(他の取引も登録しない)", async () => {
    const res = await add([
      { date: "2026-10-10", amount: 500, merchant: "Bマート" },
      { date: "2026-10-10", amount: 1000, merchant: "Aストア", items: [{ name: "牛乳", amount: 250 }, { name: "パン", amount: 330 }] },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatchObject({ index: 1, field: "items" });
    expect(res.errors[0]!.message).toContain("580円");
    expect(res.errors[0]!.message).toContain("1,000円");
    expect(res.errors[0]!.message).toContain("差額は420円");
    expect(res.errors[0]!.message).toContain("足りません");
    expect(await count("SELECT COUNT(*) AS n FROM transactions")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM transaction_items")).toBe(0);

    const over = await add([{ amount: 100, items: [{ name: "X", amount: 150 }] }]);
    expect(!over.ok && over.errors[0]!.message).toContain("多すぎます");
  });

  it("値引きのマイナス行は許可、0円・上限超え・51行以上・品名なしは拒否", async () => {
    expect((await add([{ amount: 100, items: [{ name: "商品", amount: 150 }, { name: "割引", amount: -50 }] }])).ok).toBe(true);
    const zero = await add([{ amount: 100, items: [{ name: "商品", amount: 100 }, { name: "おまけ", amount: 0 }] }]);
    expect(!zero.ok && zero.errors[0]).toMatchObject({ field: "items.1.amount" });
    const huge = await add([{ amount: 100, items: [{ name: "商品", amount: 10_000_100 }, { name: "割引", amount: -10_000_000 }] }]);
    expect(!huge.ok && huge.errors[0]).toMatchObject({ field: "items.0.amount" });
    const many = await add([{ amount: 51, items: Array.from({ length: 51 }, (_, k) => ({ name: `品${k}`, amount: 1 })) }]);
    expect(!many.ok && many.errors[0]).toMatchObject({ field: "items" });
    expect(!many.ok && many.errors[0]!.message).toContain("50行まで");
    const noName = await add([{ amount: 100, items: [{ name: " ", amount: 100 }] }]);
    expect(!noName.ok && noName.errors[0]).toMatchObject({ field: "items.0.name" });
    const unknown = await add([{ amount: 100, items: [{ name: "商品", amount: 100, price: 100 }] }]);
    expect(unknown.ok).toBe(false);
  });

  it("行の未知のカテゴリは、行の位置を示して選べる値を返す", async () => {
    const res = await add([{ amount: 300, items: [{ name: "A", amount: 100 }, { name: "B", amount: 200, category: "雑貨" }] }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ index: 0, field: "items.1.category" });
    expect(res.errors[0]!.message).toContain("選べる値");
  });

  it("status: 店名が無い、または実効カテゴリの無い行が1つでもあれば needs_review", async () => {
    // 取引のカテゴリなし、行が全部カテゴリつき → ok
    const allItems = await addOne({ amount: 300, merchant: "Cショップ", items: [{ name: "A", amount: 100, category: "食費" }, { name: "B", amount: 200, category: "日用品" }] });
    expect(allItems.status).toBe("ok");
    expect(allItems.category).toBeNull();
    // 1行だけカテゴリなし → needs_review
    const partial = await addOne({ amount: 301, merchant: "Dショップ", items: [{ name: "A", amount: 101, category: "食費" }, { name: "B", amount: 200 }] });
    expect(partial.status).toBe("needs_review");
    // 取引のカテゴリがあれば、行のカテゴリなしは取引のカテゴリに従う → ok
    const byTx = await addOne({ amount: 302, merchant: "Eショップ", category: "食費", items: [{ name: "A", amount: 102 }, { name: "B", amount: 200 }] });
    expect(byTx.status).toBe("ok");
    // 店名なし → needs_review
    const noMerchant = await addOne({ amount: 303, category: "食費", items: [{ name: "A", amount: 303 }] });
    expect(noMerchant.status).toBe("needs_review");
  });

  it("dedup_hash は変えない(日付|金額|店名)。明細が違っても同じ日・金額・店なら重複", async () => {
    await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 500 }] });
    const res = await add([{ date: "2026-10-10", amount: 500, merchant: "Aストア", items: [{ name: "B", amount: 200 }, { name: "C", amount: 300 }] }]);
    expect(res.ok && res.skipped_duplicates).toHaveLength(1);
  });
});

describe("同じお店のカテゴリの引き継ぎ", () => {
  it("カテゴリ省略・カテゴリの無い行があるとき、同じ正規化店名の直近の取引のカテゴリを使って知らせる", async () => {
    await add([{ date: "2026-10-01", amount: 100, merchant: "Ａストア", category: "食費" }]);
    await add([{ date: "2026-10-05", amount: 200, merchant: "a ストア", category: "日用品" }]);
    // 直近より古い日付の別表記は使わない
    await add([{ date: "2026-09-30", amount: 300, merchant: "AStore", category: "娯楽" }]);

    const res = await add([{ date: "2026-10-10", amount: 400, merchant: "Aストア", items: [{ name: "洗剤", amount: 400 }] }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registered[0]).toMatchObject({ category: "日用品", applied_default_category: "日用品", status: "ok" });
    expect(res.message).toContain("同じ店の直近の支出のカテゴリ");

    // 明細なしの取引も、取引そのものがカテゴリの無い行なので引き継ぐ
    const plain = await add([{ date: "2026-10-10", amount: 410, merchant: "Aストア" }]);
    expect(plain.ok && plain.registered[0]).toMatchObject({ category: "日用品", applied_default_category: "日用品" });
  });

  it("AIが明示したカテゴリ・全行にカテゴリがある取引・店名なし・初めての店には適用しない", async () => {
    await add([{ date: "2026-10-01", amount: 100, merchant: "Aストア", category: "食費" }]);
    const res = await add([
      { date: "2026-10-10", amount: 200, merchant: "Aストア", category: "娯楽" },
      { date: "2026-10-10", amount: 300, merchant: "Aストア", items: [{ name: "X", amount: 300, category: "日用品" }] },
      { date: "2026-10-10", amount: 400 },
      { date: "2026-10-10", amount: 500, merchant: "初めての店" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const r of res.registered) expect(r).not.toHaveProperty("applied_default_category");
    expect(res.registered.map((r) => r.category)).toEqual(["娯楽", null, null, null]);
    expect(res.registered.map((r) => r.status)).toEqual(["ok", "ok", "needs_review", "needs_review"]);
  });

  it("既存の支出には遡って適用しない", async () => {
    const old = await addOne({ date: "2026-10-01", amount: 100, merchant: "Aストア" });
    await addOne({ date: "2026-10-02", amount: 200, merchant: "Aストア", category: "食費" });
    const row = await db().prepare("SELECT category_id, status FROM transactions WHERE id = ?").bind(old.id).first();
    expect(row).toEqual({ category_id: null, status: "needs_review" });
  });
});

describe("list_transactions の絞り込みと include_items", () => {
  it("tax_flag は行のどれか(実効フラグ)が当てはまれば含める。any も同様", async () => {
    const drug = await addOne({
      amount: 1500,
      merchant: "Fドラッグ",
      category: "日用品",
      items: [{ name: "かぜ薬", amount: 1000, tax_flag: "self_medication" }, { name: "ティッシュ", amount: 500 }],
    });
    const flagged = await addOne({ amount: 700, merchant: "G病院", tax_flag: "medical" });
    // 取引にフラグがあっても、全行が別のフラグで上書きしていれば、その行のフラグで判定する
    const override = await addOne({ amount: 900, merchant: "H薬局", tax_flag: "medical", items: [{ name: "目薬", amount: 900, tax_flag: "self_medication" }] });
    await addOne({ amount: 300, merchant: "Aストア", category: "食費" });

    const ids = async (input: Record<string, unknown>) => {
      const res = await listTransactions(db(), input);
      return res.ok ? res.transactions.map((t) => t.id).sort() : [];
    };
    expect(await ids({ tax_flag: "self_medication" })).toEqual([drug.id, override.id].sort());
    expect(await ids({ tax_flag: "medical" })).toEqual([flagged.id]);
    expect(await ids({ tax_flag: "any" })).toEqual([drug.id, flagged.id, override.id].sort());
    // カテゴリも行の実効カテゴリのどれかで含める
    const mixed = await addOne({ amount: 800, merchant: "Iマート", category: "食費", items: [{ name: "肉", amount: 600 }, { name: "電池", amount: 200, category: "娯楽" }] });
    expect(await ids({ category: "娯楽" })).toEqual([mixed.id]);
    expect((await ids({ category: "食費" })).includes(mixed.id)).toBe(true);
  });

  it("items は既定で含め、include_items: false で省く", async () => {
    await addOne({ amount: 300, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 300 }] });
    await addOne({ amount: 200, merchant: "Bマート", category: "食費" });
    const withItems = await listTransactions(db(), {});
    expect(withItems.ok && withItems.transactions.map((t) => t.items?.length).sort()).toEqual([0, 1]);
    const without = await listTransactions(db(), { include_items: false });
    expect(without.ok && without.transactions.every((t) => !("items" in t))).toBe(true);
  });
});

describe("update_transaction の明細", () => {
  it("items は全置換。null・省略は変えない、[] で全部消す", async () => {
    const tx = await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 200 }, { name: "B", amount: 300 }] });
    const replaced = await update({ id: tx.id, items: [{ name: "C", amount: 600 }, { name: "割引", amount: -100 }] });
    expect(replaced.ok && replaced.transaction.items.map((i) => [i.position, i.name, i.amount])).toEqual([
      [0, "C", 600],
      [1, "割引", -100],
    ]);
    expect(await count("SELECT COUNT(*) AS n FROM transaction_items WHERE transaction_id = ?", tx.id)).toBe(2);

    const keep = await update({ id: tx.id, memo: "メモ", items: null });
    expect(keep.ok && keep.transaction.items.map((i) => i.name)).toEqual(["C", "割引"]);

    // items: null だけは変更なし扱いでエラー
    expect((await update({ id: tx.id, items: null })).ok).toBe(false);

    const cleared = await update({ id: tx.id, items: [] });
    expect(cleared.ok && cleared.transaction.items).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM transaction_items WHERE transaction_id = ?", tx.id)).toBe(0);
  });

  it("金額だけ・カテゴリだけの変更でも合計を検証する。合わない置換は差額を返して何も変えない", async () => {
    const tx = await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 200 }, { name: "B", amount: 300 }] });
    const amountOnly = await update({ id: tx.id, amount: 600 });
    expect(amountOnly.ok).toBe(false);
    if (amountOnly.ok) return;
    expect(amountOnly.errors[0]).toMatchObject({ field: "amount" });
    expect(amountOnly.errors[0]!.message).toContain("差額は100円");

    const bad = await update({ id: tx.id, items: [{ name: "A", amount: 100 }] });
    expect(!bad.ok && bad.errors[0]).toMatchObject({ field: "items" });

    const both = await update({ id: tx.id, amount: 600, items: [{ name: "A", amount: 600 }] });
    expect(both.ok).toBe(true);

    // カテゴリだけ変える(明細は今のまま、合計は合っている)
    const cat = await update({ id: tx.id, category: "日用品" });
    expect(cat.ok && cat.transaction).toMatchObject({ category: "日用品", amount: 600, items: [{ name: "A", amount: 600 }] });
  });

  it("status を明細から計算し直す", async () => {
    const tx = await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 200 }, { name: "B", amount: 300 }] });
    const noCat = await update({ id: tx.id, category: null });
    expect(noCat.ok && noCat.transaction.status).toBe("needs_review");
    const fixed = await update({ id: tx.id, items: [{ name: "A", amount: 200, category: "食費" }, { name: "B", amount: 300, category: "日用品" }] });
    expect(fixed.ok && fixed.transaction.status).toBe("ok");
    const unknown = await update({ id: tx.id, items: [{ name: "A", amount: 500, category: "雑貨" }] });
    expect(!unknown.ok && unknown.errors[0]).toMatchObject({ field: "items.0.category" });
  });
});

describe("集計の一貫性(支出の行)", () => {
  async function seedMixed() {
    await add([
      // 明細なし
      { date: "2026-10-01", amount: 1000, merchant: "Aストア", category: "食費" },
      { date: "2026-09-15", amount: 700, merchant: "G病院", tax_flag: "medical" },
      // 明細あり(行ごとに別のカテゴリ・フラグ、値引き行)
      {
        date: "2026-10-03",
        amount: 2600,
        merchant: "Fドラッグ",
        category: "日用品",
        items: [
          { name: "かぜ薬", amount: 1200, tax_flag: "self_medication" },
          { name: "お菓子", amount: 500, category: "食費" },
          { name: "洗剤", amount: 1000 },
          { name: "値引", amount: -100 },
        ],
      },
      // 取引のカテゴリなし、全行にカテゴリ
      { date: "2026-10-05", amount: 900, merchant: "Iマート", items: [{ name: "本", amount: 600, category: "娯楽" }, { name: "パン", amount: 300, category: "食費" }] },
    ]);
  }

  it("どの軸でも、行ごとの合計の総和は取引の合計と一致する", async () => {
    await seedMixed();
    const txTotal = (await db().prepare("SELECT SUM(amount) AS n FROM transactions").first<{ n: number }>())!.n;
    for (const groupBy of GROUP_BYS) {
      const res = await summarize(db(), { group_by: groupBy });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.total).toBe(txTotal);
      expect(res.count).toBe(4);
      expect(res.lines).toBe(2 + 4 + 2);
      if (groupBy !== "event_id") {
        expect(res.rows.reduce((s, r) => s + r.total, 0)).toBe(txTotal);
        expect(res.rows.reduce((s, r) => s + r.count, 0)).toBe(res.lines);
      }
    }
  });

  it("カテゴリ・大分類・税金フラグは行の実効値で分かれ、count は支出の行の数", async () => {
    await seedMixed();
    const byCategory = await summarize(db(), { group_by: "category" });
    expect(byCategory.ok && Object.fromEntries(byCategory.rows.map((r) => [r.key, [r.total, r.count]]))).toEqual({
      // 1000 + 500 + 300
      食費: [1800, 3],
      // 1200(行のカテゴリなし→取引の日用品) + 1000 + (-100)
      日用品: [2100, 3],
      娯楽: [600, 1],
      "(未分類)": [700, 1],
    });
    const byFlag = await summarize(db(), { group_by: "tax_flag", from: "2026-01-01", to: "2026-12-31" });
    expect(byFlag.ok && Object.fromEntries(byFlag.rows.map((r) => [r.key, r.total]))).toEqual({
      self_medication: 1200,
      medical: 700,
      "(フラグなし)": 1000 + 500 + 1000 - 100 + 900,
    });
    const byGroup = await summarize(db(), { group_by: "group", from: "2026-10-01", to: "2026-10-31" });
    expect(byGroup.ok && Object.fromEntries(byGroup.rows.map((r) => [r.key, r.total]))).toEqual({ 食費: 1800, 生活: 2100, 娯楽: 600 });
    const byMerchant = await summarize(db(), { group_by: "merchant" });
    expect(byMerchant.ok && byMerchant.rows.find((r) => r.key === "Fドラッグ")).toMatchObject({ total: 2600, count: 4 });
  });

  it("出来事別も行で数える(行の合計は取引の合計と同じ)", async () => {
    await seedMixed();
    await db()
      .prepare("INSERT INTO events (id, start_date, end_date, title, color, created_at, updated_at) VALUES ('ev1', '2026-10-03', '2026-10-05', '旅行', 'blue', ?, ?)")
      .bind(NOW.toISOString(), NOW.toISOString())
      .run();
    const res = await summarize(db(), { group_by: "event_id" });
    expect(res.ok && Object.fromEntries(res.rows.map((r) => [r.key, [r.total, r.count]]))).toEqual({ ev1: [3500, 6], "(出来事なし)": [1700, 2] });
  });

  it("リグレッション: 取引だけのデータでは、結果が従来どおり(行 = 取引)", async () => {
    await add([
      { date: "2026-10-01", amount: 1000, merchant: "Aストア", category: "食費" },
      { date: "2026-10-02", amount: 500, merchant: "Aストア", category: "食費", tax_flag: "medical" },
      { date: "2026-09-02", amount: 300, merchant: "Bマート", category: "日用品" },
      { date: "2026-09-03", amount: 200 },
    ]);
    const res = await summarize(db(), { group_by: "category" });
    expect(res).toMatchObject({
      ok: true,
      total: 2000,
      count: 4,
      lines: 4,
      rows: [
        { key: "食費", label: "食費", count: 2, total: 1500, percent: 75 },
        { key: "日用品", label: "日用品", count: 1, total: 300, percent: 15 },
        { key: "(未分類)", label: "(未分類)", count: 1, total: 200, percent: 10 },
      ],
    });
    const byMonth = await summarize(db(), { group_by: "month" });
    expect(byMonth.ok && byMonth.rows.map((r) => [r.key, r.count, r.total])).toEqual([
      ["2026-09", 2, 500],
      ["2026-10", 2, 1500],
    ]);
    const byFlag = await summarize(db(), { group_by: "tax_flag" });
    expect(byFlag.ok && byFlag.rows.map((r) => [r.key, r.count, r.total])).toEqual([
      ["(フラグなし)", 3, 1500],
      ["medical", 1, 500],
    ]);
  });

  it("ホーム: 大分類は行で、今日・今月の合計と件数はレシート(取引)で数える。最近の取引に items が付く", async () => {
    await add([
      { date: "2026-10-11", amount: 1000, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 700 }, { name: "B", amount: 300, category: "日用品" }] },
      { date: "2026-10-01", amount: 500, merchant: "Bマート", category: "娯楽" },
    ]);
    const home = await getHome(db(), { now: NOW });
    expect(home.ok).toBe(true);
    if (!home.ok) return;
    expect(home.today).toEqual({ date: "2026-10-11", total: 1000, count: 1 });
    expect(home.month).toMatchObject({ total: 1500, count: 2 });
    expect(Object.fromEntries(home.groups.map((g) => [g.key, g.total]))).toEqual({ 食費: 700, 生活: 300, 娯楽: 500 });
    expect(home.recent[0]!.items.map((i) => i.name)).toEqual(["A", "B"]);
    expect(home.recent[1]!.items).toEqual([]);

    const day = await getDay(db(), "2026-10-11");
    expect(day.ok && day).toMatchObject({ total: 1000, count: 1 });
    expect(day.ok && day.transactions[0]!.items).toHaveLength(2);
  });
});

describe("getTransaction(1件の詳細)", () => {
  it("明細・写真・リンクと件数を返す。無い id はエラー", async () => {
    const tx = await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 500 }] });
    await db()
      .prepare("INSERT INTO attachments (id, r2_key, transaction_id, created_at) VALUES ('att_1', 'photos/2026/att_1', ?, ?)")
      .bind(tx.id, NOW.toISOString())
      .run();
    await db()
      .prepare("INSERT INTO links (id, url, kind, transaction_id, created_at) VALUES ('ln_1', 'https://youtu.be/abcdefghijk', 'youtube', ?, ?)")
      .bind(tx.id, NOW.toISOString())
      .run();
    const res = await getTransaction(db(), tx.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transaction).toMatchObject({ id: tx.id, items: [{ name: "A", amount: 500 }] });
    expect(res.photos).toEqual([expect.objectContaining({ id: "att_1", url: "/api/photos/att_1", transaction_id: tx.id })]);
    expect(res.links).toEqual([expect.objectContaining({ id: "ln_1", kind: "youtube" })]);
    expect(res.counts).toEqual({ items: 1, photos: 1, links: 1 });

    const missing = await getTransaction(db(), "no-such-id");
    expect(!missing.ok && missing.errors[0]).toMatchObject({ field: "id" });
  });
});

describe("delete_transaction と明細・写真", () => {
  async function seedWithPhoto() {
    const tx = await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 300 }, { name: "B", amount: 200 }] });
    const bucket = testEnv().PHOTOS;
    for (const k of [1, 2]) {
      await bucket.put(`photos/2026/p${k}`, new Uint8Array([0xff, 0xd8, 0xff, k]), { httpMetadata: { contentType: "image/jpeg" } });
      await db()
        .prepare("INSERT INTO attachments (id, r2_key, transaction_id, created_at) VALUES (?, ?, ?, ?)")
        .bind(`p${k}`, `photos/2026/p${k}`, tx.id, NOW.toISOString())
        .run();
    }
    await db()
      .prepare("INSERT INTO links (id, url, kind, transaction_id, created_at) VALUES ('ln_1', 'https://youtu.be/abcdefghijk', 'youtube', ?, ?)")
      .bind(tx.id, NOW.toISOString())
      .run();
    return tx;
  }

  it("明細だけの取引は、明細もいっしょに消して件数を返す", async () => {
    const tx = await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 500 }] });
    const res = await deleteTransaction(db(), { id: tx.id });
    expect(res.ok && res.deleted).toMatchObject({ transaction: { id: tx.id, items: [{ name: "A" }] }, items: 1, photos: 0, links: 0 });
    expect(res.ok && res.message).toContain("明細1行");
    expect(await count("SELECT COUNT(*) AS n FROM transaction_items")).toBe(0);
  });

  it("既定では写真つきの取引を断り、枚数と delete_photos を案内する(何も消さない)", async () => {
    const tx = await seedWithPhoto();
    const res = await deleteTransaction(db(), { id: tx.id }, { bucket: testEnv().PHOTOS });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]!.message).toContain("写真2枚が紐づいています。delete_photos で写真もいっしょに削除できます");
    expect(await count("SELECT COUNT(*) AS n FROM transactions")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM transaction_items")).toBe(2);
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(2);
  });

  it("delete_photos: true で、R2の写真・写真の行・リンク・明細・取引を消し、件数を返す", async () => {
    const tx = await seedWithPhoto();
    const res = await deleteTransaction(db(), { id: tx.id, delete_photos: true }, { bucket: testEnv().PHOTOS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deleted).toMatchObject({ transaction: { id: tx.id }, items: 2, photos: 2, links: 1 });
    expect(res.message).toContain("写真2枚");
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(0);
    for (const table of ["transactions", "transaction_items", "attachments", "links"]) {
      expect(await count(`SELECT COUNT(*) AS n FROM ${table}`)).toBe(0);
    }
  });

  it("R2の削除が先。行の削除が失敗しても、再実行で残りが消える", async () => {
    const tx = await seedWithPhoto();
    const bucket = testEnv().PHOTOS;
    // R2 だけ先に消えた状態(前回の途中失敗)を作る
    await bucket.delete(["photos/2026/p1", "photos/2026/p2"]);
    const res = await deleteTransaction(db(), { id: tx.id, delete_photos: true }, { bucket });
    expect(res.ok && res.deleted.photos).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM attachments")).toBe(0);
  });
});

describe("カテゴリの使用数と削除(明細の行)", () => {
  it("明細の行のカテゴリも usage に数え、削除時は move_to が必要で、行も付け替える", async () => {
    const tx = await addOne({ amount: 500, merchant: "Aストア", category: "食費", items: [{ name: "A", amount: 200, category: "娯楽" }, { name: "B", amount: 300 }] });
    const list = await listCategories(db());
    expect(list.categories.find((c) => c.name === "娯楽")!.usage).toBe(1);

    const refused = await deleteCategory(db(), { name: "娯楽" });
    expect(refused.ok).toBe(false);
    const moved = await deleteCategory(db(), { name: "娯楽", move_to: "日用品" }, { now: NOW });
    expect(moved.ok && moved.moved).toBe(1);
    const view = await getTransaction(db(), tx.id);
    expect(view.ok && view.transaction.items.map((i) => i.category)).toEqual(["日用品", null]);
  });
});
