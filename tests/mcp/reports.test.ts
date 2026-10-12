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

describe("MCP 集計ツール", () => {
  it("tools/list に summarize と list_categories があり、説明が書かれている", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: unknown }[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["summarize", "list_categories"]));
    const summarize = tools.find((t) => t.name === "summarize");
    expect(summarize?.description).toContain("記録した範囲");
    expect(summarize?.description).toContain("二重計上");
    expect(summarize?.description.length).toBeGreaterThan(200);
    expect(JSON.stringify(summarize?.inputSchema)).toContain("event_id");
    expect(tools.find((t) => t.name === "list_categories")?.description.length).toBeGreaterThan(50);
  });

  it("list_categories を引数なしで呼べる", async () => {
    const r = await callTool("list_categories", {});
    expect(r.body.result.isError).toBeFalsy();
    const body = text(r);
    expect(body.ok).toBe(true);
    expect(body.categories).toHaveLength(5);
    expect(body.accounts).toEqual(["現金", "カード", "Suica"]);
  });

  it("add_transactions → summarize が通る", async () => {
    await callTool("add_transactions", {
      transactions: [
        { date: "2026-10-01", amount: 3000, merchant: "A店", category: "食費" },
        { date: "2026-10-02", amount: 1000, merchant: "B店", category: "日用品" },
      ],
    });
    const r = await callTool("summarize", { from: "2026-10-01", to: "2026-10-31", group_by: "category" });
    expect(r.body.result.isError).toBeFalsy();
    expect(text(r)).toMatchObject({
      ok: true,
      total: 4000,
      count: 2,
      rows: [
        { key: "食費", total: 3000, percent: 75 },
        { key: "日用品", total: 1000, percent: 25 },
      ],
    });
  });

  it("summarize の説明と入力に discounts_only があり、ツール数は増えていない", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }[];
    const s = tools.find((t) => t.name === "summarize");
    expect(s?.description).toContain("discounts_only");
    expect(s?.description).toContain("レシートに印字された割引行(マイナスの明細)だけが対象");
    expect(Object.keys(s?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["from", "to", "group_by", "discounts_only"]));
    expect(tools.some((t) => /discount/.test(t.name))).toBe(false);
    expect(tools).toHaveLength(30);
  });

  it("summarize の discounts_only: 割引の合計と、店別。通常の summarize の結果は変わらない", async () => {
    await callTool("add_transactions", {
      transactions: [
        {
          date: "2026-10-01",
          amount: 1350,
          merchant: "A店",
          category: "食費",
          items: [{ name: "品A", amount: 1000 }, { name: "品B", amount: 500 }, { name: "値引", amount: -100 }, { name: "クーポン", amount: -50 }],
        },
        { date: "2026-10-02", amount: 1000, merchant: "B店", category: "日用品" },
      ],
    });
    const total = await callTool("summarize", { discounts_only: true, from: "2026-10-01", to: "2026-10-31" });
    expect(total.body.result.isError).toBeFalsy();
    expect(text(total)).toMatchObject({ ok: true, group_by: "none", total: 150, line_count: 2, receipt_count: 1, spend_total: 2350, rows: [] });
    const byMerchant = await callTool("summarize", { discounts_only: true, group_by: "merchant" });
    expect(text(byMerchant)).toMatchObject({ ok: true, rows: [{ key: "A店", total: 150, line_count: 2, receipt_count: 1 }] });
    const normal = await callTool("summarize", { from: "2026-10-01", to: "2026-10-31", group_by: "category" });
    expect(text(normal)).toMatchObject({ ok: true, total: 2350, count: 2 });
    const off = await callTool("summarize", { discounts_only: false, group_by: "category" });
    expect(text(off)).toMatchObject({ ok: true, total: 2350 });
  });

  it("discounts_only で割引にない group_by、discounts_only なしの group_by: none はエラー", async () => {
    expect((await callTool("summarize", { discounts_only: true, group_by: "event_id" })).body.result.isError).toBe(true);
    expect((await callTool("summarize", { group_by: "none" })).body.result.isError).toBe(true);
    expect((await callTool("summarize", { discounts_only: "yes", group_by: "month" })).body.result.isError).toBe(true);
  });

  it("group_by 未指定・未知の値は isError", async () => {
    const missing = await callTool("summarize", {});
    expect(missing.body.result.isError).toBe(true);
    const unknown = await callTool("summarize", { group_by: "account" });
    expect(unknown.body.result.isError).toBe(true);
  });

  it("from > to は ok:false と errors を返す", async () => {
    const r = await callTool("summarize", { from: "2026-10-31", to: "2026-10-01", group_by: "month" });
    expect(r.body.result.isError).toBe(true);
    expect(text(r)).toMatchObject({ ok: false, errors: [{ field: "from" }] });
  });
});
