import { describe, expect, it } from "vitest";
import { addAccount, deleteAccount, listAccounts, updateAccount } from "../../src/core/accounts";
import { listCategories } from "../../src/core/categories";
import { addTransactions, listTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;

async function seed(account: string | undefined, amount = 500) {
  const res = await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount, merchant: "A店", category: "食費", account }] }, { now: NOW });
  if (!res.ok) throw new Error("seed failed");
  return res.registered[0]!;
}

const names = async () => (await listAccounts(db())).accounts.map((a) => a.name);
const errMessage = (r: { ok: boolean; errors?: { message: string }[] }) => (r.ok ? "" : r.errors![0]!.message);

describe("listAccounts", () => {
  it("初期の口座を追加順で返す(usage つき)", async () => {
    await seed("カード");
    const res = await listAccounts(db());
    expect(res.accounts).toEqual([
      { name: "現金", usage: 0 },
      { name: "カード", usage: 1 },
      { name: "Suica", usage: 0 },
    ]);
  });
});

describe("addAccount", () => {
  it("追加でき、前後の空白は取り除く。list_categories の accounts にも出て、登録に使える", async () => {
    const res = await addAccount(db(), { name: "  電子マネーA  " });
    expect(res).toMatchObject({ ok: true, account: { name: "電子マネーA", usage: 0 } });
    expect(await names()).toEqual(["現金", "カード", "Suica", "電子マネーA"]);
    expect((await listCategories(db())).accounts).toContain("電子マネーA");
    const tx = await seed("電子マネーA");
    expect(tx.account).toBe("電子マネーA");
  });

  it("空・空白だけ・31文字・「.」だけ・重複・未知の項目はエラー", async () => {
    expect((await addAccount(db(), { name: "" })).ok).toBe(false);
    expect((await addAccount(db(), { name: "   " })).ok).toBe(false);
    expect((await addAccount(db(), { name: "あ".repeat(31) })).ok).toBe(false);
    expect((await addAccount(db(), { name: ".." })).ok).toBe(false);
    expect((await addAccount(db(), { name: "x", extra: 1 })).ok).toBe(false);
    const dup = await addAccount(db(), { name: " 現金 " });
    expect(errMessage(dup)).toContain("既にあります");
    expect((await addAccount(db(), { name: "あ".repeat(30) })).ok).toBe(true);
    expect(await names()).toHaveLength(4);
  });

  it("未知の口座名での取引登録は、追加しても自動では増えない(従来どおりエラー)", async () => {
    const res = await addTransactions(db(), { transactions: [{ amount: 100, merchant: "B店", category: "食費", account: "未登録の口座" }] }, { now: NOW });
    expect(res.ok).toBe(false);
    expect(await names()).toEqual(["現金", "カード", "Suica"]);
  });
});

describe("updateAccount", () => {
  it("名前を変えると、取引の表示も新しい名前になる", async () => {
    const tx = await seed("カード");
    const res = await updateAccount(db(), { name: "カード", new_name: "クレジット" });
    expect(res).toMatchObject({ ok: true, account: { name: "クレジット", usage: 1 } });
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions.find((t) => t.id === tx.id)?.account).toBe("クレジット");
  });

  it("存在しない・同じ名前・重複・空はエラー", async () => {
    expect(errMessage(await updateAccount(db(), { name: "なし", new_name: "x" }))).toContain("選べる値: 現金、カード、Suica");
    expect(errMessage(await updateAccount(db(), { name: "現金", new_name: "現金" }))).toContain("変更する内容がありません");
    expect(errMessage(await updateAccount(db(), { name: "現金", new_name: "カード" }))).toContain("既にあります");
    expect((await updateAccount(db(), { name: "現金", new_name: " " })).ok).toBe(false);
    expect((await updateAccount(db(), { name: "現金" })).ok).toBe(false);
    expect(await names()).toEqual(["現金", "カード", "Suica"]);
  });
});

describe("deleteAccount", () => {
  it("使っていなければ name だけで削除できる", async () => {
    const res = await deleteAccount(db(), { name: "Suica" });
    expect(res).toMatchObject({ ok: true, deleted: { name: "Suica" }, moved: 0, move_to: null });
    expect(await names()).toEqual(["現金", "カード"]);
  });

  it("使っているときは move_to が必要(無いと拒否して件数を返し、何も変えない)", async () => {
    await seed("カード");
    await seed("カード", 600);
    const refused = await deleteAccount(db(), { name: "カード" });
    expect(errMessage(refused)).toContain("2件");
    expect(errMessage(refused)).toContain("move_to");
    expect(await names()).toContain("カード");
  });

  it("move_to を付けると、取引を付け替えてから削除する", async () => {
    const a = await seed("カード");
    const res = await deleteAccount(db(), { name: "カード", move_to: "現金" }, { now: NOW });
    expect(res).toMatchObject({ ok: true, moved: 1, move_to: "現金" });
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions.find((t) => t.id === a.id)?.account).toBe("現金");
    expect(await names()).toEqual(["現金", "Suica"]);
  });

  it("存在しない name / move_to、自分自身への移し替えはエラー", async () => {
    expect(errMessage(await deleteAccount(db(), { name: "なし" }))).toContain("という口座はありません");
    expect(errMessage(await deleteAccount(db(), { name: "現金", move_to: "なし" }))).toContain("選べる値: カード、Suica");
    expect(errMessage(await deleteAccount(db(), { name: "現金", move_to: "現金" }))).toContain("別のもの");
    expect(await names()).toHaveLength(3);
  });

  it("口座なしの取引は影響を受けない", async () => {
    const a = await seed(undefined);
    await deleteAccount(db(), { name: "現金" });
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions.find((t) => t.id === a.id)?.account).toBeNull();
  });
});
