import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords } from "../../src/io/jsonl";
import { importInChunks, planImportChunks } from "../../ui/src/pages/backupLogic";
import { NOW, testEnv } from "../helpers";

// 画面の「小分けして読み込む」と、サーバーの読み込みの、つなぎ目の確認。店名・金額はすべてダミー
const db = () => testEnv().DB;

describe("バックアップを小分けにして戻す", () => {
  it("書き出し → 全部消す → 小さな塊に分けて順に読み込み → 取引・明細が、すべて元どおりに戻る。もう一度読んでも増えない", async () => {
    // 取引20件、各3明細(明細は、書き出しで取引のあと、まとめて後ろに並ぶ)
    for (let i = 0; i < 20; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const r = await addTransactions(
        db(),
        {
          transactions: [
            {
              date: `2026-09-${day}`,
              amount: 600 + i,
              merchant: `ダミー商店${i}`,
              category: "食費",
              allow_duplicate: true,
              items: [
                { name: "牛乳", amount: 200 },
                { name: "卵", amount: 200 },
                { name: "パン", amount: 200 + i },
              ],
            },
          ],
        },
        { now: NOW },
      );
      expect(r.ok).toBe(true);
    }
    const before = await new Response(exportJsonl(db())).text();
    const countTx = async () => (await db().prepare("SELECT COUNT(*) AS n FROM transactions").first<{ n: number }>())!.n;
    const countItems = async () => (await db().prepare("SELECT COUNT(*) AS n FROM transaction_items").first<{ n: number }>())!.n;
    expect([await countTx(), await countItems()]).toEqual([20, 60]);

    await db().exec("DELETE FROM transaction_items");
    await db().exec("DELETE FROM transactions");

    // 1塊 12行まで(取引1+明細3=4行を1単位にして、3単位ずつ)。サーバーの上限(5000行)よりずっと小さい
    const chunks = planImportChunks(before, 12);
    expect(chunks.length).toBeGreaterThan(3);
    let calls = 0;
    const out = await importInChunks(
      chunks,
      async (body) => {
        calls++;
        const res = await importRecords(db(), body, { now: NOW });
        return res.ok ? { ...res, status: 200 } : { ok: false as const, status: res.status, error: res.error };
      },
      { sleep: async () => undefined },
    );
    expect(out.kind).toBe("done");
    expect(calls).toBe(chunks.length);
    if (out.kind === "done") {
      expect(out.rows.filter((r) => r.status === "error")).toEqual([]);
      expect(out.rows.filter((r) => r.status === "ok").length).toBe(80); // 取引20 + 明細60
    }
    expect([await countTx(), await countItems()]).toEqual([20, 60]);

    // もう一度、同じファイルを読み込んでも、増えない(全部「既にある」)
    const again = await importInChunks(
      chunks,
      async (body) => {
        const res = await importRecords(db(), body, { now: NOW });
        return res.ok ? { ...res, status: 200 } : { ok: false as const, status: res.status, error: res.error };
      },
      { sleep: async () => undefined },
    );
    expect(again.kind).toBe("done");
    if (again.kind === "done") expect(again.rows.every((r) => r.status === "skipped_exists" || r.status === "skipped_duplicate")).toBe(true);
    expect([await countTx(), await countItems()]).toEqual([20, 60]);
  });
});
