import { describe, expect, it } from "vitest";
import { addCategory, deleteCategory, listCategories, renameGroup, updateCategory } from "../../src/core/categories";
import { addTransactions, listTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

async function seed(category: string | undefined, over: Record<string, unknown> = {}) {
  const res = await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 500, merchant: "A店", category, ...over }] }, { now: NOW });
  if (!res.ok) throw new Error("seed failed");
  return res.registered[0]!;
}

const names = async () => (await listCategories(db())).categories.map((c) => c.name);
const errMessage = (r: { ok: boolean; errors?: { message: string }[] }) => (r.ok ? "" : r.errors![0]!.message);

describe("listCategories", () => {
  it("カテゴリと口座を、大分類ごと・追加順で返す(usage つき)", async () => {
    const res = await listCategories(db());
    expect(res.ok).toBe(true);
    expect(res.categories).toEqual([
      { name: "食費", group_name: "食費", usage: 0 },
      { name: "日用品", group_name: "生活", usage: 0 },
      { name: "交通・チャージ", group_name: "交通", usage: 0 },
      { name: "娯楽", group_name: "娯楽", usage: 0 },
      { name: "その他", group_name: "その他", usage: 0 },
    ]);
    expect(res.groups.map((g) => g.group_name)).toEqual(["食費", "生活", "交通", "娯楽", "その他"]);
    expect(res.accounts).toEqual(["現金", "カード", "Suica"]);
    expect(res.message).toContain("食費");
    expect(res.message).toContain("Suica");
  });

  it("呼ぶたびに同じ順で返す", async () => {
    const a = await listCategories(db());
    const b = await listCategories(db());
    expect(b).toEqual(a);
  });

  it("使っている取引の件数を usage に入れる", async () => {
    await seed("食費");
    await seed("食費", { amount: 600 });
    await seed("娯楽", { amount: 700 });
    // 別の店にする(同じ店だと、直近の支出のカテゴリを引き継ぐため)
    await seed(undefined, { amount: 800, merchant: "B店" });
    const res = await listCategories(db());
    expect(Object.fromEntries(res.categories.map((c) => [c.name, c.usage]))).toMatchObject({ 食費: 2, 娯楽: 1, 日用品: 0 });
    expect(res.groups.find((g) => g.group_name === "食費")!.categories).toEqual([{ name: "食費", usage: 2 }]);
  });

  it("後から足したカテゴリは、既存の大分類の中の末尾に並ぶ(大分類はまとまって返る)", async () => {
    await addCategory(db(), { name: "外食", group_name: "食費" });
    await addCategory(db(), { name: "光熱費", group_name: "住まい" });
    await addCategory(db(), { name: "洗剤", group_name: "生活" });
    const res = await listCategories(db());
    expect(res.groups.map((g) => [g.group_name, g.categories.map((c) => c.name)])).toEqual([
      ["食費", ["食費", "外食"]],
      ["生活", ["日用品", "洗剤"]],
      ["交通", ["交通・チャージ"]],
      ["娯楽", ["娯楽"]],
      ["その他", ["その他"]],
      ["住まい", ["光熱費"]],
    ]);
    expect(res.categories.map((c) => c.name)).toEqual(["食費", "外食", "日用品", "洗剤", "交通・チャージ", "娯楽", "その他", "光熱費"]);
  });
});

describe("addCategory", () => {
  it("既存の大分類に足す", async () => {
    const res = await addCategory(db(), { name: "外食", group_name: "食費" });
    expect(res).toMatchObject({ ok: true, category: { name: "外食", group_name: "食費", usage: 0 }, created_group: false });
    expect(await names()).toContain("外食");
  });

  it("新しい大分類を作れる", async () => {
    const res = await addCategory(db(), { name: "家賃", group_name: "住まい" });
    expect(res).toMatchObject({ ok: true, created_group: true });
    if (res.ok) expect(res.message).toContain("新しい大分類");
  });

  it("前後の空白は取り除く", async () => {
    const res = await addCategory(db(), { name: "  外食 ", group_name: " 食費  " });
    expect(res).toMatchObject({ ok: true, category: { name: "外食", group_name: "食費" } });
  });

  it("名前が重複するとエラー(別の大分類にあっても)", async () => {
    const res = await addCategory(db(), { name: "娯楽", group_name: "食費" });
    expect(res.ok).toBe(false);
    expect(errMessage(res)).toContain("既にあります");
    expect(await names()).toEqual(["食費", "日用品", "交通・チャージ", "娯楽", "その他"]);
  });

  it("追加したカテゴリは、取引の登録で使える", async () => {
    await addCategory(db(), { name: "外食", group_name: "食費" });
    const tx = await seed("外食");
    expect(tx.category).toBe("外食");
    expect(tx.status).toBe("ok");
  });

  it.each([
    [{ name: "", group_name: "食費" }, "name"],
    [{ name: "   ", group_name: "食費" }, "name"],
    [{ name: "あ".repeat(31), group_name: "食費" }, "name"],
    [{ name: "..", group_name: "食費" }, "name"],
    [{ name: "外食", group_name: "" }, "group_name"],
    [{ name: "外食", group_name: "あ".repeat(21) }, "group_name"],
    [{ name: "外食" }, "group_name"],
    [{ name: "外食", group_name: "食費", extra: 1 }, "extra"],
  ])("不正な入力はエラー %#", async (input, field) => {
    const res = await addCategory(db(), input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.field)).toContain(field);
  });

  it("30文字と20文字ちょうどは通る", async () => {
    const res = await addCategory(db(), { name: "あ".repeat(30), group_name: "い".repeat(20) });
    expect(res.ok).toBe(true);
  });
});

describe("updateCategory", () => {
  it("名前を変えても、取引はそのカテゴリのまま(新しい名前で見える)", async () => {
    const t = await seed("食費");
    const res = await updateCategory(db(), { name: "食費", new_name: "食料品" });
    expect(res).toMatchObject({ ok: true, category: { name: "食料品", group_name: "食費", usage: 1 } });
    const listed = await listTransactions(db(), {});
    expect(listed.ok && listed.transactions.find((x) => x.id === t.id)!.category).toBe("食料品");
    // 古い名前では登録できない
    const old = await addTransactions(db(), { transactions: [{ amount: 100, category: "食費" }] });
    expect(old.ok).toBe(false);
  });

  it("大分類を移す(新しい大分類も可)。取引の status は変わらない", async () => {
    const t = await seed("日用品");
    expect(await updateCategory(db(), { name: "日用品", group_name: "食費" })).toMatchObject({ ok: true, created_group: false });
    expect((await listCategories(db())).categories.find((c) => c.name === "日用品")!.group_name).toBe("食費");
    expect(await updateCategory(db(), { name: "日用品", group_name: "住まい" })).toMatchObject({ ok: true, created_group: true });
    const row = await db().prepare("SELECT status FROM transactions WHERE id = ?").bind(t.id).first();
    expect(row).toEqual({ status: "ok" });
  });

  it("名前と大分類を同時に変えられる", async () => {
    const res = await updateCategory(db(), { name: "娯楽", new_name: "趣味", group_name: "遊び" });
    expect(res).toMatchObject({ ok: true, category: { name: "趣味", group_name: "遊び" } });
  });

  it("新しい名前が重複するとエラー", async () => {
    const res = await updateCategory(db(), { name: "娯楽", new_name: "食費" });
    expect(res.ok).toBe(false);
    expect(errMessage(res)).toContain("既にあります");
  });

  it("存在しないカテゴリはエラー", async () => {
    const res = await updateCategory(db(), { name: "なぞ", new_name: "x" });
    expect(res.ok).toBe(false);
    expect(errMessage(res)).toContain("「なぞ」というカテゴリはありません");
  });

  it("1つも変更が無いとエラー(項目なし・同じ値)", async () => {
    expect((await updateCategory(db(), { name: "食費" })).ok).toBe(false);
    const same = await updateCategory(db(), { name: "食費", new_name: "食費", group_name: "食費" });
    expect(same.ok).toBe(false);
    expect(errMessage(same)).toContain("変更");
  });

  it("空・長すぎる new_name / group_name はエラー", async () => {
    expect((await updateCategory(db(), { name: "食費", new_name: " " })).ok).toBe(false);
    expect((await updateCategory(db(), { name: "食費", group_name: "あ".repeat(21) })).ok).toBe(false);
  });
});

describe("renameGroup", () => {
  it("大分類の名前を変える(件数を返す)", async () => {
    await addCategory(db(), { name: "外食", group_name: "食費" });
    const res = await renameGroup(db(), { group: "食費", new_name: "食べ物" });
    expect(res).toMatchObject({ ok: true, group: "食べ物", previous: "食費", updated: 2, merged: false });
    const cats = (await listCategories(db())).categories;
    expect(cats.filter((c) => c.group_name === "食べ物").map((c) => c.name)).toEqual(["食費", "外食"]);
  });

  it("既存の別の大分類と同名にすると統合になる", async () => {
    const res = await renameGroup(db(), { group: "交通", new_name: "生活" });
    expect(res).toMatchObject({ ok: true, updated: 1, merged: true });
    const groups = (await listCategories(db())).groups;
    expect(groups.find((g) => g.group_name === "生活")!.categories.map((c) => c.name)).toEqual(["日用品", "交通・チャージ"]);
    expect(groups.some((g) => g.group_name === "交通")).toBe(false);
  });

  it("存在しない大分類・同じ名前・不正な名前はエラー", async () => {
    const none = await renameGroup(db(), { group: "なぞ", new_name: "x" });
    expect(errMessage(none)).toContain("「なぞ」という大分類はありません");
    expect(errMessage(await renameGroup(db(), { group: "食費", new_name: "食費" }))).toContain("変更");
    expect((await renameGroup(db(), { group: "食費", new_name: "" })).ok).toBe(false);
    expect((await renameGroup(db(), { group: "食費", new_name: "あ".repeat(21) })).ok).toBe(false);
  });

  it("集計の大分類も新しい名前になる", async () => {
    await seed("日用品");
    await renameGroup(db(), { group: "生活", new_name: "暮らし" });
    const row = await db().prepare("SELECT c.group_name AS g FROM transactions t JOIN categories c ON c.id = t.category_id").first();
    expect(row).toEqual({ g: "暮らし" });
  });
});

describe("deleteCategory", () => {
  it("使われていなければ、そのまま削除できる", async () => {
    const res = await deleteCategory(db(), { name: "娯楽" });
    expect(res).toMatchObject({ ok: true, deleted: { name: "娯楽", group_name: "娯楽" }, moved: 0, move_to: null });
    expect(await names()).not.toContain("娯楽");
  });

  it("使われていて move_to が無いとエラー(件数と案内を出す)", async () => {
    await seed("娯楽");
    await seed("娯楽", { amount: 600 });
    const res = await deleteCategory(db(), { name: "娯楽" });
    expect(res.ok).toBe(false);
    expect(errMessage(res)).toContain("2件の支出が使っています");
    expect(errMessage(res)).toContain("move_to");
    expect(await names()).toContain("娯楽");
  });

  it("move_to があれば、取引を付け替えてから削除する", async () => {
    const a = await seed("娯楽");
    const b = await seed("娯楽", { amount: 600 });
    const other = await seed("食費", { amount: 700 });
    const res = await deleteCategory(db(), { name: "娯楽", move_to: "その他" }, { now: NOW });
    expect(res).toMatchObject({ ok: true, moved: 2, move_to: "その他" });
    const listed = await listTransactions(db(), {});
    if (!listed.ok) throw new Error("list failed");
    const cat = (id: string) => listed.transactions.find((t) => t.id === id)!.category;
    expect([cat(a.id), cat(b.id), cat(other.id)]).toEqual(["その他", "その他", "食費"]);
    expect(listed.transactions.every((t) => t.status === "ok")).toBe(true);
    expect(await names()).not.toContain("娯楽");
  });

  it("移し先が自分自身・存在しないときはエラーで、何も変わらない", async () => {
    const t = await seed("娯楽");
    expect(errMessage(await deleteCategory(db(), { name: "娯楽", move_to: "娯楽" }))).toContain("別のもの");
    expect(errMessage(await deleteCategory(db(), { name: "娯楽", move_to: "なぞ" }))).toContain("「なぞ」というカテゴリはありません");
    expect(await names()).toContain("娯楽");
    const row = await db().prepare("SELECT category_id FROM transactions WHERE id = ?").bind(t.id).first();
    expect(row).toEqual({ category_id: "cat_leisure" });
  });

  it("存在しないカテゴリはエラー", async () => {
    expect(errMessage(await deleteCategory(db(), { name: "なぞ" }))).toContain("「なぞ」というカテゴリはありません");
  });

  it("最後の1つのカテゴリは削除できない", async () => {
    for (const n of ["食費", "日用品", "交通・チャージ", "娯楽"]) expect((await deleteCategory(db(), { name: n })).ok).toBe(true);
    const res = await deleteCategory(db(), { name: "その他" });
    expect(res.ok).toBe(false);
    expect(errMessage(res)).toContain("最後の1つ");
    expect(await names()).toEqual(["その他"]);
  });

  it("使われていなくても move_to を付けて呼べる(何も移さない)", async () => {
    const res = await deleteCategory(db(), { name: "娯楽", move_to: "その他" });
    expect(res).toMatchObject({ ok: true, moved: 0, move_to: null });
  });
});
