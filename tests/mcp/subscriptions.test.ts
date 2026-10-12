import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
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

describe("MCP サブスク・固定費のツール", () => {
  it("tools/list に4ツールがあり、説明が具体的(金額の調べ方・別枠・解約の扱い)", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: { required?: string[] } }[];
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName("add_subscription").inputSchema.required).toEqual(["name", "amount", "period"]);
    expect(byName("add_subscription").description).toContain("別枠");
    expect(byName("add_subscription").description).toContain("年額");
    expect(byName("update_subscription").description).toContain("price_checked");
    expect(byName("update_subscription").description).toContain("active: false");
    expect(byName("list_subscriptions").description).toContain("price_checked_on");
    expect(byName("delete_subscription").description).toContain("active: false");
    for (const n of ["add_subscription", "list_subscriptions", "update_subscription", "delete_subscription"]) expect(byName(n).description.length).toBeGreaterThan(80);
  });

  it("add → list → update(金額変更)→ delete の往復", async () => {
    const add = text(await callTool("add_subscription", { name: "ダミー動画", amount: 1000, period: "monthly", url: "https://example.test/price" }));
    expect(add).toMatchObject({ ok: true, subscription: { name: "ダミー動画", monthly_equivalent: 1000 } });
    const id = add.subscription.id as string;

    const list = text(await callTool("list_subscriptions", {}));
    expect(list).toMatchObject({ ok: true, count: 1, totals: { monthly: 1000, yearly: 12000, count: 1 } });

    const up = text(await callTool("update_subscription", { id, amount: 1300 }));
    expect(up).toMatchObject({ ok: true, subscription: { amount: 1300, previous_amount: 1000 } });

    const cancel = text(await callTool("update_subscription", { id, active: false }));
    expect(cancel.subscription.active).toBe(false);
    expect(text(await callTool("list_subscriptions", { active: true }))).toMatchObject({ count: 0, totals: { monthly: 0 } });

    expect(text(await callTool("delete_subscription", { id }))).toMatchObject({ ok: true });
    const gone = await callTool("delete_subscription", { id });
    expect(gone.body.result.isError).toBe(true);
  });

  it("不正な入力はエラー(周期・金額)", async () => {
    const bad = await callTool("add_subscription", { name: "A", amount: 100, period: "weekly" });
    expect(bad.body.result.isError).toBe(true);
    const neg = await callTool("add_subscription", { name: "A", amount: -1, period: "monthly" });
    expect(neg.body.result.isError).toBe(true);
  });
});
