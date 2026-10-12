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

const X_POST = "https://x.com/example_user/status/1234567890";
const YT = "https://youtu.be/dQw4w9WgXcQ";

describe("MCP リンクのツール", () => {
  it("tools/list は30個で、リンクの3ツールの説明が具体的", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: { required?: string[] } }[];
    expect(tools).toHaveLength(30);
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName("add_link").description).toContain("Xの投稿");
    expect(byName("add_link").description).toContain("YouTube");
    expect(byName("add_link").inputSchema.required).toEqual(["url"]);
    expect(byName("list_links").description).toContain("delete_link");
    expect(byName("delete_link").description).toContain("list_links");
    for (const n of ["add_link", "list_links", "delete_link"]) expect(byName(n).description.length).toBeGreaterThan(80);
  });

  it("add_link → list_links → delete_link の往復", async () => {
    const add = await callTool("add_link", { url: `${YT}?si=abc`, title: "動画", date: "2026-10-10" });
    expect(add.body.result.isError).toBeFalsy();
    const added = text(add);
    expect(added).toMatchObject({ ok: true, duplicate: false, link: { url: YT, kind: "youtube", title: "動画", date: "2026-10-10" } });

    const dup = text(await callTool("add_link", { url: YT, date: "2026-10-10" }));
    expect(dup).toMatchObject({ ok: true, duplicate: true, link: { id: added.link.id } });

    const list = text(await callTool("list_links", { date: "2026-10-10" }));
    expect(list).toMatchObject({ ok: true, count: 1 });
    expect(list.links[0].id).toBe(added.link.id);

    expect(text(await callTool("delete_link", { id: added.link.id }))).toMatchObject({ ok: true });
    expect(text(await callTool("list_links", { date: "2026-10-10" }))).toMatchObject({ count: 0 });
    const gone = await callTool("delete_link", { id: added.link.id });
    expect(gone.body.result.isError).toBe(true);
  });

  it("許可リスト外のURLは、対応サイトと直し方を示すエラー", async () => {
    const r = await callTool("add_link", { url: "https://example.com/a", date: "2026-10-10" });
    expect(r.body.result.isError).toBe(true);
    // 入力スキーマ(Zod)の検証メッセージがそのまま返る
    const message = r.body.result.content[0].text as string;
    expect(message).toContain("url");
    expect(message).toContain("対応しているのは");
    expect(message).toContain("x.com");
    expect(message).toContain("youtu.be");
  });

  it("紐づけ先なし・存在しない取引はエラー、取引に付けたリンクを取引の id で引ける", async () => {
    expect((await callTool("add_link", { url: X_POST })).body.result.isError).toBe(true);
    expect((await callTool("add_link", { url: X_POST, transaction_id: "nope" })).body.result.isError).toBe(true);
    const tx = text(await callTool("add_transactions", { transactions: [{ date: "2026-10-10", amount: 500, merchant: "A店", category: "食費" }] }));
    const id = tx.registered[0].id as string;
    expect(text(await callTool("add_link", { url: X_POST, transaction_id: id })).ok).toBe(true);
    expect(text(await callTool("list_links", { transaction_id: id }))).toMatchObject({ count: 1 });
    expect((await callTool("list_links", {})).body.result.isError).toBe(true);
  });
});
