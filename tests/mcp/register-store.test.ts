import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const env = () => ({ DB: testEnv().DB, AUTH_BYPASS: "1" });

async function rpc(method: string, params?: unknown) {
  const res = await createApp().request(
    "http://localhost/mcp",
    { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) },
    env(),
  );
  return (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const text = (r: any) => JSON.parse(r.result.content[0].text); // eslint-disable-line @typescript-eslint/no-explicit-any

interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
}

describe("MCP のレジ番号・店番号と説明文", () => {
  it("スキーマに register_no / store_code があり、add → update の通しで動く", async () => {
    const tools = (await rpc("tools/list")).result.tools as Tool[];
    for (const name of ["add_transactions", "update_transaction"]) {
      const schema = JSON.stringify(tools.find((t) => t.name === name)!.inputSchema);
      expect(schema).toContain("register_no");
      expect(schema).toContain("store_code");
    }
    const added = await rpc("tools/call", { name: "add_transactions", arguments: { transactions: [{ date: "2026-10-01", amount: 700, merchant: "Aストア", category: "食費", register_no: "0005", store_code: "007832" }] } });
    expect(text(added).registered[0]).toMatchObject({ register_no: "0005", store_code: "007832" });
    const id = text(added).registered[0].id as string;
    const updated = await rpc("tools/call", { name: "update_transaction", arguments: { id, register_no: null } });
    expect(text(updated).transaction).toMatchObject({ register_no: null, store_code: "007832" });
  });

  it("add_transactions / update_transaction の説明に、メモへ入れない方針と口座の扱いが書かれている", async () => {
    const tools = (await rpc("tools/list")).result.tools as Tool[];
    for (const name of ["add_transactions", "update_transaction"]) {
      const d = tools.find((t) => t.name === name)!.description;
      expect(d, name).toContain("メモには入れない");
      expect(d, name).toContain("tax_lines");
      expect(d, name).toContain("register_no");
      expect(d, name).toContain("store_code");
      expect(d, name).toContain("add_account");
      expect(d, name).toContain("list_categories");
      expect(d, name).toContain("ユーザーに確認");
    }
    const lc = tools.find((t) => t.name === "list_categories")!.description;
    expect(lc).toContain("口座");
    expect(lc).toContain("add_account");
  });
});
