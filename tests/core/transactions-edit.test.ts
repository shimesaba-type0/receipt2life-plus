import { describe, expect, it } from "vitest";
import { addTransactions, deleteTransaction, listTransactions, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

async function seed(item: Record<string, unknown>): Promise<string> {
  const res = await addTransactions(db(), { transactions: [{ date: "2026-10-01", source: "manual", ...item }] }, { now: NOW });
  if (!res.ok || !res.registered[0]) throw new Error("seed failed");
  return res.registered[0].id;
}

const update = (input: unknown) => updateTransaction(db(), input, { now: NOW });

describe("updateTransaction", () => {
  it("単項目だけ直し、ほかは変えない", async () => {
    const id = await seed({ amount: 1280, merchant: "A店", category: "食費", account: "現金" });
    const res = await update({ id, amount: 1380 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transaction).toEqual({
      id,
      date: "2026-10-01",
      amount: 1380,
      merchant: "A店",
      category: "食費",
      account: "現金",
      memo: null,
      source: "manual",
      status: "ok",
      tax_flag: null,
    });
    expect(res.warnings).toEqual([]);
    expect(res.message).toBe("更新しました: A店 1,380円");
  });

  it("複数項目を同時に直す", async () => {
    const id = await seed({ amount: 500, merchant: "A店", category: "食費" });
    const res = await update({ id, date: "2026-09-30", amount: 900, merchant: "B店", memo: "訂正", source: "receipt" });
    expect(res.ok && res.transaction).toMatchObject({ date: "2026-09-30", amount: 900, merchant: "B店", memo: "訂正", source: "receipt" });
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions[0]).toMatchObject({ id, amount: 900, merchant: "B店", memo: "訂正" });
  });

  it("null で空にできる(店名・カテゴリ・口座・メモ)", async () => {
    const id = await seed({ amount: 500, merchant: "A店", category: "食費", account: "現金", memo: "x" });
    const res = await update({ id, merchant: null, category: null, account: null, memo: null });
    expect(res.ok && res.transaction).toMatchObject({ merchant: null, category: null, account: null, memo: null, status: "needs_review" });
  });

  it("カテゴリと口座を変える", async () => {
    const id = await seed({ amount: 500, merchant: "A店", category: "食費", account: "現金" });
    const res = await update({ id, category: "日用品", account: "Suica" });
    expect(res.ok && res.transaction).toMatchObject({ category: "日用品", account: "Suica", status: "ok" });
  });

  it("status を再計算する(空から埋めると ok に戻る)", async () => {
    const id = await seed({ amount: 500, merchant: "A店" });
    const before = await listTransactions(db(), {});
    expect(before.ok && before.transactions[0]?.status).toBe("needs_review");
    const res = await update({ id, category: "食費" });
    expect(res.ok && res.transaction.status).toBe("ok");
    const res2 = await update({ id, merchant: null });
    expect(res2.ok && res2.transaction.status).toBe("needs_review");
  });

  it("updated_at を更新し、created_at は変えない", async () => {
    const id = await seed({ amount: 500, merchant: "A店", category: "食費" });
    const t = (await db().prepare("SELECT created_at, updated_at FROM transactions WHERE id = ?").bind(id).first<{ created_at: string; updated_at: string }>())!;
    await updateTransaction(db(), { id, memo: "m" }, { now: new Date("2026-10-11T04:00:00Z") });
    const after = (await db().prepare("SELECT created_at, updated_at FROM transactions WHERE id = ?").bind(id).first<{ created_at: string; updated_at: string }>())!;
    expect(after.created_at).toBe(t.created_at);
    expect(after.updated_at).toBe("2026-10-11T04:00:00.000Z");
  });

  it("dedup_hash を再計算する(直した内容で、add の重複判定が変わる)", async () => {
    const id = await seed({ amount: 500, merchant: "A店", category: "食費" });
    await update({ id, amount: 600, merchant: "Ｂ店" });
    // 修正前の内容は、もう重複ではない
    const old = await addTransactions(db(), { transactions: [{ date: "2026-10-01", amount: 500, merchant: "A店" }] }, { now: NOW });
    expect(old.ok && old.registered).toHaveLength(1);
    // 修正後の内容(全角半角の違いは吸収)は、重複になる
    const dup = await addTransactions(db(), { transactions: [{ date: "2026-10-01", amount: 600, merchant: "B店" }] }, { now: NOW });
    expect(dup.ok && dup.skipped_duplicates).toEqual([{ index: 0, existing_id: id }]);
  });

  it("ほかの取引と重複しそうなら、更新したうえで warnings を返す", async () => {
    const other = await seed({ amount: 700, merchant: "A店", category: "食費" });
    const id = await seed({ amount: 300, merchant: "A店", category: "食費" });
    const res = await update({ id, amount: 700 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.transaction.amount).toBe(700);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]?.duplicate_of).toBe(other);
    expect(res.warnings[0]?.message).toContain(other);
    expect(res.message).toContain("重複の疑い");
  });

  it("自分自身とは重複扱いにしない", async () => {
    const id = await seed({ amount: 700, merchant: "A店" });
    const res = await update({ id, memo: "同じ内容のまま" });
    expect(res.ok && res.warnings).toEqual([]);
  });

  it("未来日付・不正な金額・未知のカテゴリと口座は、直せるエラーにする", async () => {
    const id = await seed({ amount: 500, merchant: "A店", category: "食費" });
    const future = await update({ id, date: "2026-10-12" });
    expect(future.ok === false && future.errors[0]).toMatchObject({ field: "date" });
    const amount = await update({ id, amount: 12.5 });
    expect(amount.ok === false && amount.errors[0]).toMatchObject({ field: "amount" });
    const big = await update({ id, amount: 100_000_000 });
    expect(big.ok).toBe(false);
    const unknown = await update({ id, category: "食事", account: "小切手" });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.errors[0]).toMatchObject({ field: "category" });
    expect(unknown.errors[0]?.message).toContain("食費");
    expect(unknown.errors[1]).toMatchObject({ field: "account" });
    expect(unknown.errors[1]?.message).toContain("現金");
    // エラーなら何も変わらない
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions[0]).toMatchObject({ date: "2026-10-01", amount: 500 });
  });

  it("date と amount は null にできない", async () => {
    const id = await seed({ amount: 500 });
    const res = await update({ id, amount: null, date: null });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => e.field).sort()).toEqual(["amount", "date"]);
  });

  it("未知の項目名と、変更項目がない呼び出しはエラー", async () => {
    const id = await seed({ amount: 500 });
    const typo = await update({ id, store: "A店" });
    expect(typo.ok === false && typo.errors[0]).toMatchObject({ field: "store" });
    const empty = await update({ id });
    expect(empty.ok === false && empty.errors[0]?.message).toContain("1つ以上");
  });

  it("存在しない id は、分かる文章でエラーにする", async () => {
    const res = await update({ id: "no-such-id", amount: 100 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ field: "id" });
    expect(res.errors[0]?.message).toContain("no-such-id");
    expect(res.errors[0]?.message).toContain("ありません");
  });

  it("id がなければエラー", async () => {
    const res = await update({ amount: 100 });
    expect(res.ok === false && res.errors[0]).toMatchObject({ field: "id" });
  });
});

describe("deleteTransaction", () => {
  it("削除して、内容とメッセージを返す", async () => {
    const id = await seed({ amount: 1280, merchant: "A店", category: "食費", account: "現金" });
    const res = await deleteTransaction(db(), { id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deleted).toMatchObject({ id, amount: 1280, merchant: "A店", category: "食費", account: "現金" });
    expect(res.message).toBe("削除しました: A店 1,280円");
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions).toEqual([]);
  });

  it("店名がなければ (店名なし) と書く", async () => {
    const id = await seed({ amount: 300 });
    const res = await deleteTransaction(db(), { id });
    expect(res.ok && res.message).toBe("削除しました: (店名なし) 300円");
  });

  it("存在しない id はエラー", async () => {
    const res = await deleteTransaction(db(), { id: "no-such-id" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ field: "id" });
    expect(res.errors[0]?.message).toContain("ありません");
  });

  it("未知の項目や id なしはエラー", async () => {
    expect((await deleteTransaction(db(), {})).ok).toBe(false);
    const res = await deleteTransaction(db(), { id: "x", force: true });
    expect(res.ok === false && res.errors[0]).toMatchObject({ field: "force" });
  });

  it("写真が紐づく取引は、削除せずエラーにする", async () => {
    const id = await seed({ amount: 1280, merchant: "A店", category: "食費" });
    await db()
      .prepare("INSERT INTO attachments (id, r2_key, transaction_id, created_at) VALUES (?, ?, ?, ?)")
      .bind("att_1", "dummy/key.jpg", id, NOW.toISOString())
      .run();
    const res = await deleteTransaction(db(), { id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toMatchObject({ field: "id" });
    expect(res.errors[0]?.message).toContain("写真が");
    expect(res.errors[0]?.message).toContain("削除できません");
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions).toHaveLength(1);
  });
});
