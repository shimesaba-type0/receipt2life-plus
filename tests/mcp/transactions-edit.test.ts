import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const env = () => ({ DB: testEnv().DB, AUTH_BYPASS: "1" });

async function rpc(method: string, params?: unknown, id: number | undefined = 1) {
  const res = await createApp().request(
    "http://localhost/mcp",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    },
    env(),
  );
  return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const callTool = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
const text = (r: Awaited<ReturnType<typeof rpc>>) => JSON.parse(r.body.result.content[0].text);

describe("MCP update_transaction / delete_transaction", () => {
  it("tools/list に両方があり、説明が書かれている", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: unknown }[];
    const update = tools.find((t) => t.name === "update_transaction");
    const del = tools.find((t) => t.name === "delete_transaction");
    expect(update?.description.length).toBeGreaterThan(100);
    expect(del?.description.length).toBeGreaterThan(50);
    expect(update?.description).toContain("null");
    expect(update?.description).toContain("warnings");
    expect(del?.description).toContain("取り消せない");
    expect(del?.description).toContain("list_transactions");
    expect(JSON.stringify(update?.inputSchema)).toContain("merchant");
  });

  it("add → update → list → delete の通し", async () => {
    const added = await callTool("add_transactions", {
      transactions: [{ date: "2026-10-01", amount: 1280, merchant: "A店", category: "食費", account: "現金", source: "receipt" }],
    });
    const id = text(added).registered[0].id as string;

    const updated = await callTool("update_transaction", { id, amount: 1380, memo: "訂正", account: null });
    expect(updated.body.result.isError).toBeFalsy();
    expect(text(updated)).toMatchObject({
      ok: true,
      transaction: { id, amount: 1380, memo: "訂正", account: null, status: "ok" },
      warnings: [],
      message: "更新しました: A店 1,380円",
    });

    const listed = await callTool("list_transactions", {});
    expect(text(listed).transactions).toMatchObject([{ id, amount: 1380, memo: "訂正", account: null }]);

    const deleted = await callTool("delete_transaction", { id });
    expect(deleted.body.result.isError).toBeFalsy();
    expect(text(deleted)).toMatchObject({ ok: true, deleted: { transaction: { id, amount: 1380 } }, message: "削除しました: A店 1,380円" });

    const after = await callTool("list_transactions", {});
    expect(text(after).transactions).toEqual([]);
  });

  it("ドメイン上のエラー(存在しない id、未知のカテゴリ)は ok:false と errors を返す", async () => {
    const missing = await callTool("update_transaction", { id: "no-such-id", amount: 100 });
    expect(missing.body.result.isError).toBe(true);
    expect(text(missing)).toMatchObject({ ok: false, errors: [{ field: "id" }] });

    const added = await callTool("add_transactions", { transactions: [{ amount: 100, merchant: "A店" }] });
    const id = text(added).registered[0].id as string;
    const unknown = await callTool("update_transaction", { id, category: "なぞ" });
    expect(unknown.body.result.isError).toBe(true);
    expect(text(unknown)).toMatchObject({ ok: false, errors: [{ field: "category" }] });

    const del = await callTool("delete_transaction", { id: "no-such-id" });
    expect(del.body.result.isError).toBe(true);
    expect(text(del)).toMatchObject({ ok: false, errors: [{ field: "id" }] });
  });

  it("重複しそうな更新は、成功しつつ warnings を返す", async () => {
    const added = await callTool("add_transactions", {
      transactions: [
        { date: "2026-10-01", amount: 500, merchant: "A店" },
        { date: "2026-10-01", amount: 900, merchant: "A店" },
      ],
    });
    const [first, second] = text(added).registered as { id: string }[];
    const r = await callTool("update_transaction", { id: second!.id, amount: 500 });
    expect(r.body.result.isError).toBeFalsy();
    expect(text(r).warnings).toMatchObject([{ duplicate_of: first!.id }]);
  });
});
