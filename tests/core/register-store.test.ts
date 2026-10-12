import { describe, expect, it } from "vitest";
import { MAX_REGISTER_NO, MAX_STORE_CODE, registerNoField, storeCodeField } from "../../src/core/receipt-details";
import { addTransactions, dedupHash, getTransaction, listTransactions, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// レジ番号(register_no)と店番号(store_code)。値はダミー
const db = () => testEnv().DB;
const add = (transactions: unknown[]) => addTransactions(db(), { transactions }, { now: NOW });

describe("register_no / store_code の検証", () => {
  it("前後の空白を除き、空は拒否、30文字まで", () => {
    expect(registerNoField.parse("  0005 ")).toBe("0005");
    expect(storeCodeField.parse(" 007832")).toBe("007832");
    expect(registerNoField.safeParse("   ").success).toBe(false);
    expect(storeCodeField.safeParse("").success).toBe(false);
    expect(registerNoField.safeParse("1".repeat(MAX_REGISTER_NO)).success).toBe(true);
    expect(registerNoField.safeParse("1".repeat(MAX_REGISTER_NO + 1)).success).toBe(false);
    expect(storeCodeField.safeParse("1".repeat(MAX_STORE_CODE + 1)).success).toBe(false);
    expect(registerNoField.safeParse(5).success).toBe(false);
  });
});

describe("register_no / store_code の登録・更新", () => {
  it("登録で正規化して保存し、取得・一覧に出る。省略は null", async () => {
    const res = await add([
      { date: "2026-10-10", amount: 1000, merchant: "Aストア", register_no: " 0005 ", store_code: "007832", receipt_no: "P20261003152814" },
      { date: "2026-10-11", amount: 500, merchant: "B店" },
    ]);
    expect(res.ok && res.registered.map((r) => [r.register_no, r.store_code, r.receipt_no])).toEqual([
      ["0005", "007832", "P20261003152814"],
      [null, null, null],
    ]);
    const id = res.ok ? res.registered[0]!.id : "";
    const got = await getTransaction(db(), id);
    expect(got.ok && got.transaction).toMatchObject({ register_no: "0005", store_code: "007832" });
    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions.find((t) => t.merchant === "B店")).toMatchObject({ register_no: null, store_code: null });
  });

  it("不正な値はエラー(項目名つき)", async () => {
    const res = await add([{ date: "2026-10-10", amount: 1000, register_no: "1".repeat(31), store_code: "  " }]);
    expect(res.ok).toBe(false);
    const fields = res.ok ? [] : res.errors.map((e) => e.field).join(",");
    expect(fields).toContain("register_no");
    expect(fields).toContain("store_code");
  });

  it("update: 渡さなければ変えない、null で空にできる", async () => {
    const res = await add([{ date: "2026-10-10", amount: 1000, merchant: "Aストア", register_no: "0005", store_code: "007832" }]);
    const id = res.ok ? res.registered[0]!.id : "";
    const a = await updateTransaction(db(), { id, memo: "メモ" }, { now: NOW });
    expect(a.ok && a.transaction).toMatchObject({ register_no: "0005", store_code: "007832" });
    const b = await updateTransaction(db(), { id, register_no: null, store_code: "000123" }, { now: NOW });
    expect(b.ok && b.transaction).toMatchObject({ register_no: null, store_code: "000123" });
    const got = await getTransaction(db(), id);
    expect(got.ok && got.transaction).toMatchObject({ register_no: null, store_code: "000123" });
  });

  it("dedup_hash に含めない: レジ番号・店番号が違っても同じ日・金額・店名は重複", async () => {
    await add([{ date: "2026-10-10", amount: 1000, merchant: "Aストア", register_no: "0005" }]);
    const res = await add([{ date: "2026-10-10", amount: 1000, merchant: "Aストア", register_no: "0006", store_code: "1" }]);
    expect(res.ok && res.registered).toHaveLength(0);
    expect(res.ok && res.skipped_duplicates).toHaveLength(1);
    const row = await db().prepare("SELECT dedup_hash FROM transactions").first<{ dedup_hash: string }>();
    expect(row?.dedup_hash).toBe(await dedupHash("2026-10-10", 1000, "Aストア"));
  });
});
