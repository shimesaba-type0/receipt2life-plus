import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

// 税率・税の内訳と summarize_tax の MCP。店名・金額はダミー
const env = () => ({ DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" });

async function rpc(method: string, params?: unknown) {
  const res = await createApp().request(
    "http://localhost/mcp",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    env(),
  );
  return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const callTool = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
const text = (r: Awaited<ReturnType<typeof rpc>>) => JSON.parse(r.body.result.content[0].text);

interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
}

describe("MCP の税率・税の内訳", () => {
  it("ツールは30個で summarize_tax がある。説明に読み取りの考え方が書かれている", async () => {
    const tools = (await rpc("tools/list")).body.result.tools as Tool[];
    expect(tools).toHaveLength(35);
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    const add = tool("add_transactions").description;
    expect(add).toContain("税率はレシートに印字された数字をそのまま入れる(8、10、1 など。計算しない)");
    expect(add).toContain("軽減税率の記号(※・＊・軽");
    expect(add).toContain("凡例");
    expect(add).toContain("tax_label に入れてよい");
    expect(add).toContain("tax_lines に入れる");
    expect(add).toContain("amount_basis に入れる");
    expect(add).toContain("推測せずユーザーに聞く");
    expect(add).toContain("tax_flag(医療費控除・セルフメディケーション税制・寄附金控除の控除用フラグ)とは別物");
    const addSchema = JSON.stringify(tool("add_transactions").inputSchema);
    for (const key of ["tax_rate", "tax_label", "tax_lines", "amount_basis", "taxable_amount", "tax_amount"]) expect(addSchema).toContain(key);
    expect(JSON.stringify(tool("update_transaction").inputSchema)).toContain("tax_lines");
    expect(tool("update_transaction").description).toContain("tax_flag(医療費控除など)とは別物");
    expect(tool("summarize_tax").description).toContain("カバレッジ");
    expect(tool("summarize_tax").description).toContain("計算することはしない");
    expect(JSON.stringify(tool("summarize_tax").inputSchema)).toContain("group_by");
  });

  it("add → list → summarize_tax → update(tax_lines の置き換え)", async () => {
    const added = await callTool("add_transactions", {
      transactions: [
        {
          date: "2026-10-01",
          amount: 1640,
          merchant: "Aストア",
          source: "receipt",
          items: [
            { name: "牛乳", amount: 540, tax_rate: 8, tax_label: "※" },
            { name: "洗剤", amount: 1100, tax_rate: 10 },
          ],
          tax_lines: [
            { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included" },
            { rate: 8, taxable_amount: 540, tax_amount: 40, amount_basis: "included", label: "※" },
          ],
        },
        { date: "2026-10-02", amount: 500, merchant: "Bマート" },
      ],
    });
    expect(added.body.result.isError).toBeFalsy();
    const id = text(added).registered[0].id as string;

    const listed = text(await callTool("list_transactions", {}));
    expect(listed.transactions.find((t: { id: string }) => t.id === id).tax_lines).toHaveLength(2);

    const sum = text(await callTool("summarize_tax", { from: "2026-10-01", to: "2026-10-31" }));
    expect(sum).toMatchObject({ ok: true, totals: { tax_total: 140 }, coverage: { without_tax_lines: { count: 1, total: 500 } } });
    expect(sum.message).toContain("この集計に含まれていません");

    const updated = text(await callTool("update_transaction", { id, tax_lines: [{ rate: 1, tax_amount: 16 }] }));
    expect(updated.transaction.tax_lines).toMatchObject([{ rate: 1, tax_amount: 16 }]);
    const byMonth = text(await callTool("summarize_tax", { group_by: "month" }));
    expect(byMonth.rows).toMatchObject([{ month: "2026-10", rate: 1, tax_total: 16 }]);

    const bad = await callTool("summarize_tax", { group_by: "weekly" });
    expect(bad.body.result.isError).toBe(true);
  });
});
