import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const env = () => ({ DB: testEnv().DB, AUTH_BYPASS: "1" });

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

describe("MCP の tax_flag", () => {
  it("4つのツールの説明とスキーマに tax_flag が書かれている", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as Tool[];
    const get = (name: string) => tools.find((t) => t.name === name)!;

    for (const name of ["add_transactions", "update_transaction", "list_transactions", "summarize"]) {
      expect(get(name).description, name).toContain("tax_flag");
    }

    const add = JSON.stringify(get("add_transactions").inputSchema);
    for (const v of ["medical", "self_medication", "donation", "医療費控除", "セルフメディケーション税制", "寄附金控除"]) expect(add).toContain(v);
    expect(add).toContain("薬局");
    expect(add).toContain("利用者");

    expect(get("update_transaction").description).toContain("null");
    expect(get("list_transactions").description).toContain("any");
    expect(JSON.stringify(get("list_transactions").inputSchema)).toContain("any");
    expect(JSON.stringify(get("summarize").inputSchema)).toContain("tax_flag");
  });

  it("add → list(any) → summarize → update(解除) の通し", async () => {
    const added = await callTool("add_transactions", {
      transactions: [
        { date: "2026-10-01", amount: 1280, merchant: "A薬局", category: "日用品", tax_flag: "self_medication" },
        { date: "2026-10-02", amount: 500, merchant: "B店", category: "食費" },
      ],
    });
    expect(text(added)).toMatchObject({ ok: true, registered: [{ tax_flag: "self_medication" }, { tax_flag: null }] });
    const id = text(added).registered[0].id as string;

    const listed = await callTool("list_transactions", { tax_flag: "any" });
    expect(text(listed).transactions.map((t: { merchant: string }) => t.merchant)).toEqual(["A薬局"]);

    const sum = await callTool("summarize", { group_by: "tax_flag", from: "2026-01-01", to: "2026-12-31" });
    expect(text(sum).rows[0]).toMatchObject({ label: "セルフメディケーション税制", total: 1280 });

    const cleared = await callTool("update_transaction", { id, tax_flag: null });
    expect(text(cleared)).toMatchObject({ ok: true, transaction: { id, tax_flag: null } });
    const after = await callTool("list_transactions", { tax_flag: "any" });
    expect(text(after).count).toBe(0);
  });

  it("不正な値は入力検証で拒否される", async () => {
    const r = await callTool("add_transactions", { transactions: [{ amount: 100, tax_flag: "bogus" }] });
    const body = r.body.result.isError ? r.body.result.content[0].text : JSON.stringify(text(r));
    expect(body).toContain("tax_flag");
  });
});
