import { describe, expect, it } from "vitest";
import { addCategory, deleteCategory, listCategories } from "../../src/core/categories";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");

async function doImport(text: string): Promise<Extract<ImportResponse, { ok: true }>> {
  const res = await importRecords(db(), text, { now: NOW });
  if (!res.ok) throw new Error(`import failed: ${res.error}`);
  return res;
}

// エクスポート由来のバックアップ行(id と created_at がある)
const backupTx = (over: Record<string, unknown> = {}) => ({
  type: "transaction",
  id: "tx1",
  date: "2026-10-10",
  amount: 1280,
  merchant: "A店",
  category: "外食",
  account: "現金",
  created_at: "2026-10-10T01:00:00.000Z",
  updated_at: "2026-10-10T01:00:00.000Z",
  ...over,
});

describe("カテゴリが増えたあとのバックアップ", () => {
  it("書き出し → 初期データだけの別のDBに戻すと、新しいカテゴリが「その他」の大分類に作られる", async () => {
    await addCategory(db(), { name: "外食", group_name: "食費" });
    const added = await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 1280, merchant: "A店", category: "外食" }] }, { now: NOW });
    expect(added.ok).toBe(true);
    const backup = await new Response(exportJsonl(db())).text();
    expect(backup).toContain('"category":"外食"');

    // 別の環境を想定: 取引を消し、追加したカテゴリも消す(初期データだけに戻る)
    await db().exec("DELETE FROM transactions");
    expect((await deleteCategory(db(), { name: "外食" })).ok).toBe(true);

    const res = await doImport(backup);
    expect(res.summary).toEqual({ total: 1, ok: 1, skipped: 0, errors: 0 });
    const cats = (await listCategories(db())).categories;
    expect(cats.at(-1)).toEqual({ name: "外食", group_name: "その他", usage: 1 });
    expect(cats).toHaveLength(6);
  });

  it("同じ新カテゴリを使う複数行でも1回だけ作る。同じバックアップをもう一度戻しても増えない", async () => {
    const text = jsonl(backupTx(), backupTx({ id: "tx2", amount: 300 }), backupTx({ id: "tx3", category: "光熱費", amount: 8000 }));
    const first = await doImport(text);
    expect(first.summary.ok).toBe(3);
    expect((await listCategories(db())).categories.map((c) => c.name).slice(5)).toEqual(["外食", "光熱費"]);

    const second = await doImport(text);
    expect(second.summary).toMatchObject({ ok: 0, skipped: 3, errors: 0 });
    expect((await listCategories(db())).categories).toHaveLength(7);
  });

  it("既にあるカテゴリは作らない(大分類もそのまま)", async () => {
    const res = await doImport(jsonl(backupTx({ category: "日用品" })));
    expect(res.summary.ok).toBe(1);
    const cats = (await listCategories(db())).categories;
    expect(cats).toHaveLength(5);
    expect(cats.find((c) => c.name === "日用品")).toMatchObject({ group_name: "生活", usage: 1 });
  });

  it("取り込まれない行(id が既にある)のカテゴリは作らない", async () => {
    await doImport(jsonl(backupTx({ category: "食費" })));
    const res = await doImport(jsonl(backupTx({ category: "外食" })));
    expect(res.results[0]!.status).toBe("skipped_exists");
    expect((await listCategories(db())).categories.map((c) => c.name)).not.toContain("外食");
  });

  it("バックアップ行でない行(id か created_at が無い)は、従来どおり未知のカテゴリがエラー", async () => {
    const res = await doImport(jsonl(backupTx({ created_at: undefined, updated_at: undefined }), backupTx({ id: undefined, category: "外食" })));
    expect(res.results.map((r) => r.status)).toEqual(["error", "error"]);
    expect(res.results[0]!.message).toContain("自動作成しません");
    expect((await listCategories(db())).categories).toHaveLength(5);
  });

  it("名前の規則に合わないカテゴリ(長すぎる・前後の空白)は、バックアップ行でもエラー", async () => {
    const res = await doImport(jsonl(backupTx({ category: "あ".repeat(31) }), backupTx({ id: "tx2", category: " 外食 " })));
    expect(res.results.map((r) => r.status)).toEqual(["error", "error"]);
    expect((await listCategories(db())).categories).toHaveLength(5);
  });

  it("口座は従来どおり自動作成しない(その行はエラーで、カテゴリも作らない)", async () => {
    const res = await doImport(jsonl(backupTx({ account: "ゆうちょ" })));
    expect(res.results[0]!.status).toBe("error");
    expect((await listCategories(db())).categories).toHaveLength(5);
  });
});
