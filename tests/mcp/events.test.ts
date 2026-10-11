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

describe("MCP 出来事のツール", () => {
  it("tools/list に add_event / update_event / list_events があり、説明が詳しい", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: unknown }[];
    for (const name of ["add_event", "update_event", "list_events"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.description.length).toBeGreaterThan(100);
    }
    const addSchema = JSON.stringify(tools.find((t) => t.name === "add_event")!.inputSchema);
    for (const color of ["red", "orange", "green", "blue", "purple"]) expect(addSchema).toContain(color);
    expect(tools.find((t) => t.name === "add_event")!.description).toContain("単日");
  });

  it("add_event → list_events → update_event が通る", async () => {
    const added = await callTool("add_event", { title: "出張", start_date: "2026-10-03", end_date: "2026-10-05" });
    expect(added.body.result.isError).toBeFalsy();
    expect(text(added)).toMatchObject({ ok: true, message: "出来事を登録しました: 出張 2026-10-03〜2026-10-05(blue)" });
    const id = text(added).event.id as string;

    const listed = await callTool("list_events", { from: "2026-10-04", to: "2026-10-31" });
    expect(text(listed)).toMatchObject({ ok: true, count: 1, events: [{ id, title: "出張", color: "blue" }] });

    const purple = await callTool("update_event", { id, color: "purple" });
    expect(text(purple).event).toMatchObject({ color: "purple", end_date: "2026-10-05" });
    // 色を指定しない更新で、青に戻らない
    const renamed = await callTool("update_event", { id, title: "出張(大阪)", end_date: null });
    expect(text(renamed).event).toMatchObject({ title: "出張(大阪)", color: "purple", end_date: null });
  });

  it("ドメイン上のエラーは ok:false と errors を返す", async () => {
    const order = await callTool("add_event", { title: "A", start_date: "2026-10-05", end_date: "2026-10-01" });
    expect(order.body.result.isError).toBe(true);
    expect(text(order)).toMatchObject({ ok: false, errors: [{ field: "end_date" }] });

    const missing = await callTool("update_event", { id: "no-such-id", title: "A" });
    expect(missing.body.result.isError).toBe(true);
    expect(text(missing)).toMatchObject({ ok: false, errors: [{ field: "id" }] });
  });

  it("入力の型エラー(未知の色)は isError で理由を返す", async () => {
    const r = await callTool("add_event", { title: "A", start_date: "2026-10-05", color: "pink" });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toContain("color");
  });
});
