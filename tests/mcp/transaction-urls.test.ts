import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { transactionUrl, withTransactionUrls } from "../../src/mcp/urls";
import { testEnv } from "../helpers";

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

describe("取引のMCPの戻り値に、明細ページのURLを付ける", () => {
  it("add_transactions の registered に url、重複には existing_url", async () => {
    const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const added = text(await callTool("add_transactions", { transactions: [{ date, amount: 500, merchant: "ダミー店", category: "食費" }] }));
    const t = added.registered[0];
    expect(t.url).toBe(`http://localhost/tx/${t.id}`);

    const dup = text(await callTool("add_transactions", { transactions: [{ date, amount: 500, merchant: "ダミー店", category: "食費" }] }));
    expect(dup.skipped_duplicates[0].existing_url).toBe(`http://localhost/tx/${t.id}`);
  });

  it("update_transaction の transaction と、list_transactions の各取引に url", async () => {
    const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const added = text(await callTool("add_transactions", { transactions: [{ date, amount: 700, merchant: "ダミー店", category: "食費" }] }));
    const id = added.registered[0].id as string;
    const up = text(await callTool("update_transaction", { id, amount: 800 }));
    expect(up.transaction.url).toBe(`http://localhost/tx/${id}`);
    const list = text(await callTool("list_transactions", { limit: 5 }));
    expect(list.transactions.every((t: { id: string; url: string }) => t.url === `http://localhost/tx/${t.id}`)).toBe(true);
  });

  it("説明文が、URLを利用者に見せるよう案内する", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string }[];
    for (const n of ["add_transactions", "update_transaction", "list_transactions"]) expect(tools.find((t) => t.name === n)!.description).toContain("url");
  });
});

describe("withTransactionUrls", () => {
  it("失敗の結果はそのまま。id は URL エンコードする", () => {
    const bad = { ok: false as const, errors: [] };
    expect(withTransactionUrls("https://example.test", bad)).toBe(bad);
    expect(transactionUrl("https://example.test", "a b/c")).toBe("https://example.test/tx/a%20b%2Fc");
  });
});
