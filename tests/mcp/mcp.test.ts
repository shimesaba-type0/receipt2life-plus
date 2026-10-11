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

describe("MCP /mcp", () => {
  it("認証なしは401(AUTH_BYPASSなし)", async () => {
    const res = await createApp().request(
      "http://localhost/mcp",
      { method: "POST", body: "{}" },
      { DB: testEnv().DB },
    );
    expect(res.status).toBe(401);
  });

  it("initialize に応答する(ステートレス)", async () => {
    const r = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(r.status).toBe(200);
    expect(r.body.result.serverInfo.name).toBe("receipt2life");
    expect(r.body.result.capabilities.tools).toBeDefined();
  });

  it("tools/list に add_transactions と list_transactions があり、説明が書かれている", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: unknown }[];
    // ツールは、機能ごとに増えていく。最低限、取引の登録と一覧があることを確かめる
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["add_transactions", "list_transactions"]));
    for (const t of tools) expect(t.description.length).toBeGreaterThan(50);
    const add = tools.find((t) => t.name === "add_transactions");
    expect(JSON.stringify(add?.inputSchema)).toContain("allow_duplicate");
  });

  it("add_transactions → list_transactions が通る", async () => {
    const added = await callTool("add_transactions", {
      transactions: [{ date: "2026-10-01", amount: 1280, merchant: "A店", category: "食費", account: "現金", source: "receipt" }],
    });
    expect(added.body.result.isError).toBeFalsy();
    expect(text(added)).toMatchObject({ ok: true, message: "1件登録しました: A店 1,280円" });

    const listed = await callTool("list_transactions", { from: "2026-10-01", to: "2026-10-31" });
    expect(text(listed).transactions).toHaveLength(1);
  });

  it("入力エラーは isError で、直せる文章を返す", async () => {
    const r = await callTool("add_transactions", { transactions: [{ amount: 12.5 }] });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toContain("整数");
  });

  it("ドメイン上のエラー(未知のカテゴリ)は ok:false と errors を返す", async () => {
    const r = await callTool("add_transactions", { transactions: [{ amount: 100, category: "なぞ" }] });
    expect(r.body.result.isError).toBe(true);
    expect(text(r)).toMatchObject({ ok: false, errors: [{ index: 0, field: "category" }] });
  });
});
