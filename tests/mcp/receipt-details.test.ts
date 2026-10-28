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

const FIELDS = ["paid_time", "merchant_phone", "merchant_address", "invoice_number", "receipt_no"];

describe("MCP のレシートの情報", () => {
  it("add_transactions の説明に、拾う項目・省略・読めないときの確認(3択)が書かれ、スキーマに6項目がある", async () => {
    const tools = (await rpc("tools/list")).body.result.tools as Tool[];
    const get = (name: string) => tools.find((t) => t.name === name)!;
    const add = get("add_transactions");

    for (const f of FIELDS) expect(add.description, f).toContain(f);
    expect(add.description).toContain("推測で埋めない");
    expect(add.description).toContain("利用者に値を教えてもらって補う");
    expect(add.description).toContain("合計金額だけ登録する");
    expect(add.description).toContain("登録をやめる");
    expect(add.description).toContain("利用者が決めるまで登録しない");
    expect(add.description).toContain("update_transaction で補う");
    expect(add.description).toContain("タクシー");
    expect(add.description).toContain("登録番号");
    expect(add.description).toContain("keyword");

    const schema = JSON.stringify(add.inputSchema);
    for (const f of FIELDS) expect(schema, f).toContain(f);
    expect(schema).toContain("T + 数字13桁");

    const update = get("update_transaction");
    for (const f of FIELDS) expect(JSON.stringify(update.inputSchema), f).toContain(f);
    expect(update.description).toContain("receipt_no");
    expect(update.description).toContain("null");

    const list = get("list_transactions");
    expect(JSON.stringify(list.inputSchema)).toContain("keyword");
    expect(list.description).toContain("keyword");
  });

  it("add → list(keyword) → update(null で空) の通し", async () => {
    const added = await callTool("add_transactions", {
      transactions: [
        { date: "2026-10-01", amount: 2400, merchant: "Aタクシー", category: "交通・チャージ", paid_time: "14:32", merchant_phone: "03-0000-0000", invoice_number: "T0000000000000" },
        { date: "2026-10-02", amount: 500, merchant: "B店", category: "食費" },
      ],
    });
    expect(text(added)).toMatchObject({ ok: true, registered: [{ paid_time: "14:32", merchant_phone: "03-0000-0000" }, { paid_time: null }] });
    const id = text(added).registered[0].id as string;

    const byPhone = await callTool("list_transactions", { keyword: "0300000000" });
    expect(text(byPhone).transactions.map((t: { merchant: string }) => t.merchant)).toEqual(["Aタクシー"]);
    expect(text(byPhone).transactions[0]).toMatchObject({ invoice_number: "T0000000000000" });
    expect(Object.keys(text(byPhone).transactions[0])).not.toContain("clerk_name");

    const cleared = await callTool("update_transaction", { id, merchant_phone: null, receipt_no: "R-1" });
    expect(text(cleared)).toMatchObject({ ok: true, transaction: { merchant_phone: null, receipt_no: "R-1", paid_time: "14:32" } });
    expect(text(await callTool("list_transactions", { keyword: "0300000000" })).count).toBe(0);
  });

  it("不正な登録番号・時刻はエラーで、日本語の理由が返る", async () => {
    const r = await callTool("add_transactions", { transactions: [{ amount: 100, invoice_number: "T12", paid_time: "25:00" }] });
    const body = r.body.result.isError ? r.body.result.content[0].text : JSON.stringify(text(r));
    expect(body).toContain("invoice_number");
    expect(body).toContain("T と数字13桁で入力してください");
    expect(body).toContain("paid_time");
  });

  it("clerk_name は入力項目にない。説明に「記録しない」と書かれ、渡すと未知の項目としてエラーになり、保存されない", async () => {
    const tools = (await rpc("tools/list")).body.result.tools as Tool[];
    for (const name of ["add_transactions", "update_transaction", "list_transactions"]) {
      const t = tools.find((x) => x.name === name)!;
      expect(JSON.stringify(t.inputSchema)).not.toContain("clerk_name");
      expect(t.description).not.toContain("clerk_name");
    }
    expect(tools.find((x) => x.name === "add_transactions")!.description).toContain("店員名・店員コード・担当者番号は記録しない");

    // 入力の検証で断られる(未知の項目)。何も保存されない
    const added = await callTool("add_transactions", { transactions: [{ date: "2026-10-01", amount: 700, merchant: "Aタクシー", category: "交通・チャージ", clerk_name: "山田" }] });
    expect(added.body.result.isError).toBe(true);
    expect(added.body.result.content[0].text).toContain("clerk_name");
    const n = await testEnv().DB.prepare("SELECT COUNT(*) AS n FROM transactions").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
