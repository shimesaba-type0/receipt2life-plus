import { describe, expect, it } from "vitest";
import { getTransaction, addTransactions, deleteTransaction, listTransactions, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// 税率(明細の tax_rate / tax_label)と税の内訳(tax_lines)。店名・品名・金額はダミー
const db = () => testEnv().DB;
const add = (transactions: unknown[]) => addTransactions(db(), { transactions }, { now: NOW });
const update = (input: unknown) => updateTransaction(db(), input, { now: NOW });
const count = async (table: string) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const receipt = (over: Record<string, unknown> = {}) => ({
  date: "2026-10-10",
  amount: 1640,
  merchant: "Aストア",
  category: "食費",
  items: [
    { name: "牛乳", amount: 540, tax_rate: 8, tax_label: "※" },
    { name: "洗剤", amount: 1100, category: "日用品", tax_rate: 10 },
  ],
  tax_lines: [
    { rate: 8, taxable_amount: 540, tax_amount: 40, amount_basis: "included", label: "※" },
    { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included" },
  ],
  ...over,
});

async function addOne(over: Record<string, unknown> = {}) {
  const res = await add([receipt(over)]);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res;
}

describe("税率と税の内訳の記録", () => {
  it("明細の tax_rate / tax_label と tax_lines を印字どおりに記録し、一覧・詳細に出す(内訳は税率の高い順)", async () => {
    const res = await addOne();
    const tx = res.registered[0]!;
    expect(res.tax_warnings).toEqual([]);
    expect(tx.items.map((i) => [i.name, i.tax_rate, i.tax_label])).toEqual([
      ["牛乳", 8, "※"],
      ["洗剤", 10, null],
    ]);
    expect(tx.tax_lines.map((l) => ({ ...l, id: undefined }))).toEqual([
      { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included", label: null },
      { rate: 8, taxable_amount: 540, tax_amount: 40, amount_basis: "included", label: "※" },
    ]);

    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions[0]!.tax_lines).toEqual(tx.tax_lines);
    expect(list.ok && list.transactions[0]!.items?.[0]).toMatchObject({ tax_rate: 8, tax_label: "※" });
    const detail = await getTransaction(db(), tx.id);
    expect(detail.ok && detail.transaction.tax_lines).toEqual(tx.tax_lines);

    // include_items: false では明細も内訳も省く
    const light = await listTransactions(db(), { include_items: false });
    expect(light.ok && "tax_lines" in light.transactions[0]!).toBe(false);
  });

  it("旧形式(税率・内訳なし)の入力も通り、明細の tax_rate は null、tax_lines は空配列", async () => {
    const res = await add([{ date: "2026-10-10", amount: 300, merchant: "Bマート", items: [{ name: "パン", amount: 300 }] }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registered[0]!.items[0]).toMatchObject({ tax_rate: null, tax_label: null });
    expect(res.registered[0]!.tax_lines).toEqual([]);
  });

  it("小数の税率(0.5)や表に無い税率(1)もそのまま入る。0% も入る。8 と 8.0 は同じ税率", async () => {
    const res = await addOne({
      amount: 1000,
      items: [{ name: "米", amount: 1000, tax_rate: 0.5 }],
      tax_lines: [
        { rate: 0.5, tax_amount: 5 },
        { rate: 1, tax_amount: 10 },
        { rate: 0, taxable_amount: 0 },
      ],
    });
    expect(res.registered[0]!.items[0]!.tax_rate).toBe(0.5);
    expect(res.registered[0]!.tax_lines.map((l) => l.rate)).toEqual([1, 0.5, 0]);

    const dup = await add([receipt({ tax_lines: [{ rate: 8 }, { rate: 8.0 }] })]);
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.errors[0]!.message).toContain("税率 8% の行が2つあります");
  });

  it("範囲外・小数第4位・記号の長さ・負や小数の金額・未知の amount_basis はエラー(全件ロールバック)", async () => {
    const bad = [
      { items: [{ name: "a", amount: 1640, tax_rate: 101 }] },
      { items: [{ name: "a", amount: 1640, tax_rate: -1 }] },
      { items: [{ name: "a", amount: 1640, tax_rate: 8.0001 }] },
      { items: [{ name: "a", amount: 1640, tax_label: "あ".repeat(21) }] },
      { tax_lines: [{ rate: 10, tax_amount: -1 }] },
      { tax_lines: [{ rate: 10, taxable_amount: 1.5 }] },
      { tax_lines: [{ rate: 10, amount_basis: "gross" }] },
      { tax_lines: [{ tax_amount: 100 }] },
      { tax_lines: Array.from({ length: 11 }, (_, k) => ({ rate: k })) },
    ];
    for (const over of bad) {
      const res = await add([receipt(over)]);
      expect(res.ok, JSON.stringify(over)).toBe(false);
    }
    expect(await count("transactions")).toBe(0);
    expect(await count("transaction_tax_lines")).toBe(0);
  });

  it("記号の空文字・空白だけは値なし(null)。前後の空白は除く", async () => {
    const res = await addOne({ items: [{ name: "a", amount: 1640, tax_rate: 8, tax_label: "  " }], tax_lines: [{ rate: 8, label: " 軽 " }] });
    expect(res.registered[0]!.items[0]!.tax_label).toBeNull();
    expect(res.registered[0]!.tax_lines[0]!.label).toBe("軽");
  });

  it("内訳の合計が金額と合わなくてもエラーにせず、tax_warnings で知らせる(税込・税抜とも)", async () => {
    const inc = await add([receipt({ tax_lines: [{ rate: 10, taxable_amount: 1000, tax_amount: 90, amount_basis: "included" }] })]);
    expect(inc.ok).toBe(true);
    if (!inc.ok) return;
    expect(inc.tax_warnings).toHaveLength(1);
    expect(inc.tax_warnings[0]).toMatchObject({ index: 0, field: "tax_lines" });
    expect(inc.tax_warnings[0]!.message).toContain("一致しません");
    expect(inc.message).toContain("tax_warnings");

    // 税抜: 対象金額 + 税額 = 金額なら警告なし
    const exc = await add([receipt({ date: "2026-10-09", amount: 1100, items: undefined, tax_lines: [{ rate: 10, taxable_amount: 1000, tax_amount: 100, amount_basis: "excluded" }] })]);
    expect(exc.ok && exc.tax_warnings).toEqual([]);
    // 混在・不明は確かめない
    const mixed = await add([receipt({ date: "2026-10-08", tax_lines: [{ rate: 10, taxable_amount: 1, amount_basis: "excluded" }, { rate: 8, taxable_amount: 1 }] })]);
    expect(mixed.ok && mixed.tax_warnings).toEqual([]);
  });
});

describe("税の内訳の更新・削除", () => {
  it("tax_lines は全置換。省略・null は変えない、[] で消す。tax_lines: null だけは変更なしのエラー", async () => {
    const tx = (await addOne()).registered[0]!;

    const same = await update({ id: tx.id, memo: "メモ" });
    expect(same.ok && same.transaction.tax_lines).toEqual(tx.tax_lines);
    const nullOnly = await update({ id: tx.id, tax_lines: null });
    expect(nullOnly.ok).toBe(false);

    const replaced = await update({ id: tx.id, tax_lines: [{ rate: 1, taxable_amount: 1640, tax_amount: 16, amount_basis: "included", label: "★" }] });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.transaction.tax_lines).toMatchObject([{ rate: 1, tax_amount: 16, label: "★" }]);
    expect(replaced.message).toContain("税の内訳1行に置き換えました");
    expect(replaced.tax_warnings).toEqual([]);
    expect(await count("transaction_tax_lines")).toBe(1);

    const cleared = await update({ id: tx.id, tax_lines: [] });
    expect(cleared.ok && cleared.transaction.tax_lines).toEqual([]);
    expect(await count("transaction_tax_lines")).toBe(0);
  });

  it("金額だけ変えると、今の内訳と合わなければ tax_warnings が出る(更新は行う)", async () => {
    const tx = (await addOne({ items: undefined })).registered[0]!;
    const res = await update({ id: tx.id, amount: 2000 });
    expect(res.ok).toBe(true);
    expect(res.ok && res.tax_warnings).toHaveLength(1);
  });

  it("明細の置き換えで tax_rate / tax_label も置き換わる", async () => {
    const tx = (await addOne()).registered[0]!;
    const res = await update({ id: tx.id, items: [{ name: "牛乳", amount: 540, tax_rate: 8.0, tax_label: "軽" }, { name: "洗剤", amount: 1100 }] });
    expect(res.ok && res.transaction.items.map((i) => [i.tax_rate, i.tax_label])).toEqual([
      [8, "軽"],
      [null, null],
    ]);
  });

  it("取引の削除で、税の内訳もいっしょに消える", async () => {
    const tx = (await addOne()).registered[0]!;
    const res = await deleteTransaction(db(), { id: tx.id });
    expect(res.ok).toBe(true);
    expect(res.ok && res.deleted.transaction.tax_lines).toHaveLength(2);
    expect(await count("transaction_tax_lines")).toBe(0);
  });
});
