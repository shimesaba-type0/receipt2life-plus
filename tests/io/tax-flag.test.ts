import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");
const exportRecords = async () =>
  (await new Response(exportJsonl(db())).text()).trimEnd().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const flagOf = async (id: string) => (await db().prepare("SELECT tax_flag FROM transactions WHERE id = ?").bind(id).first<{ tax_flag: string | null }>())?.tax_flag;

describe("JSONL と tax_flag", () => {
  it("エクスポートの取引の行に tax_flag を含める(なしは null)", async () => {
    await addTransactions(
      db(),
      {
        transactions: [
          { date: "2026-10-01", amount: 1000, merchant: "A薬局", tax_flag: "medical" },
          { date: "2026-10-02", amount: 2000, merchant: "B店" },
        ],
      },
      { now: NOW },
    );
    const rows = (await exportRecords()).filter((r) => r.type === "transaction");
    expect(rows.find((r) => r.merchant === "A薬局")).toMatchObject({ tax_flag: "medical" });
    expect(rows.find((r) => r.merchant === "B店")).toHaveProperty("tax_flag", null);
  });

  it("export → 全削除 → import で、フラグも戻る", async () => {
    await addTransactions(
      db(),
      {
        transactions: [
          { date: "2026-10-01", amount: 1000, merchant: "A薬局", tax_flag: "self_medication" },
          { date: "2026-10-02", amount: 2000, merchant: "B店" },
          { date: "2026-10-03", amount: 3000, merchant: "C町", tax_flag: "donation" },
        ],
      },
      { now: NOW },
    );
    const text = await new Response(exportJsonl(db())).text();
    await db().prepare("DELETE FROM transactions").run();
    const res = await importRecords(db(), text, { now: NOW });
    expect(res.ok && res.summary).toMatchObject({ ok: 3, errors: 0 });
    const { results } = await db().prepare("SELECT merchant, tax_flag FROM transactions ORDER BY date").all<{ merchant: string; tax_flag: string | null }>();
    expect(results).toEqual([
      { merchant: "A薬局", tax_flag: "self_medication" },
      { merchant: "B店", tax_flag: null },
      { merchant: "C町", tax_flag: "donation" },
    ]);
  });

  it("古いバックアップ(tax_flag なし)も取り込める", async () => {
    const old = {
      type: "transaction",
      id: "old1",
      date: "2026-10-01",
      amount: 1280,
      merchant: "A店",
      category: "食費",
      account: "現金",
      memo: null,
      source: "receipt",
      status: "ok",
      created_at: "2026-10-01T03:00:00.000Z",
      updated_at: "2026-10-01T03:00:00.000Z",
    };
    const res = await importRecords(db(), jsonl(old), { now: NOW });
    expect(res.ok && res.summary).toMatchObject({ ok: 1, errors: 0 });
    expect(await flagOf("old1")).toBeNull();
  });

  it("tax_flag つきの手書きの行を取り込める。不正な値はその行だけエラー", async () => {
    const res = await importRecords(
      db(),
      jsonl(
        { type: "transaction", id: "n1", date: "2026-10-01", amount: 500, merchant: "A", tax_flag: "donation" },
        { type: "transaction", id: "n2", date: "2026-10-01", amount: 600, merchant: "B", tax_flag: "bogus" },
        { type: "transaction", id: "n3", date: "2026-10-01", amount: 700, merchant: "C", tax_flag: null },
      ),
      { now: NOW },
    );
    expect(res.ok && res.results.map((r) => r.status)).toEqual(["ok", "error", "ok"]);
    expect(res.ok && res.results[1]?.message).toContain("tax_flag");
    expect(await flagOf("n1")).toBe("donation");
    expect(await flagOf("n3")).toBeNull();
  });
});
