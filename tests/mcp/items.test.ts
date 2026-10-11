import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

// 明細(items)の MCP。店名・品名はダミー
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

interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
}

describe("MCP の明細", () => {
  it("ツールの説明とスキーマに items / include_items / delete_photos が書かれている", async () => {
    const tools = (await rpc("tools/list")).body.result.tools as Tool[];
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    expect(tool("add_transactions").description).toContain("品名・金額の行をそのまま items に入れる");
    expect(tool("add_transactions").description).toContain("値引き・割引はマイナスの行");
    expect(tool("add_transactions").description).toContain("明細の合計は amount と一致させる");
    expect(JSON.stringify(tool("add_transactions").inputSchema)).toContain("items");
    expect(JSON.stringify(tool("update_transaction").inputSchema)).toContain("items");
    expect(JSON.stringify(tool("list_transactions").inputSchema)).toContain("include_items");
    expect(JSON.stringify(tool("delete_transaction").inputSchema)).toContain("delete_photos");
    expect(tool("summarize").description).toContain("支出の行");
  });

  it("add → list(items つき)→ summarize(行で数える)→ update(全置換)→ delete", async () => {
    const added = await callTool("add_transactions", {
      transactions: [
        {
          date: "2026-10-01",
          amount: 1500,
          merchant: "Fドラッグ",
          category: "日用品",
          source: "receipt",
          items: [
            { name: "かぜ薬", amount: 1000, tax_flag: "self_medication" },
            { name: "ティッシュ", amount: 600 },
            { name: "値引", amount: -100 },
          ],
        },
      ],
    });
    expect(added.body.result.isError).toBeFalsy();
    const id = text(added).registered[0].id as string;

    const listed = text(await callTool("list_transactions", { tax_flag: "self_medication" }));
    expect(listed.transactions).toHaveLength(1);
    expect(listed.transactions[0].items.map((i: { name: string }) => i.name)).toEqual(["かぜ薬", "ティッシュ", "値引"]);

    const sum = text(await callTool("summarize", { group_by: "tax_flag" }));
    expect(sum).toMatchObject({ total: 1500, count: 1, lines: 3 });
    expect(sum.rows).toEqual([
      expect.objectContaining({ key: "self_medication", total: 1000, count: 1 }),
      expect.objectContaining({ key: "(フラグなし)", total: 500, count: 2 }),
    ]);

    const mismatch = await callTool("update_transaction", { id, items: [{ name: "かぜ薬", amount: 1000 }] });
    expect(mismatch.body.result.isError).toBe(true);
    expect(text(mismatch).errors[0].message).toContain("差額は500円");

    const updated = await callTool("update_transaction", { id, items: [{ name: "かぜ薬", amount: 1000, tax_flag: "self_medication" }, { name: "ティッシュ", amount: 500 }] });
    expect(text(updated).transaction.items).toHaveLength(2);

    const deleted = text(await callTool("delete_transaction", { id }));
    expect(deleted).toMatchObject({ ok: true, deleted: { transaction: { id }, items: 2, photos: 0, links: 0 } });
  });

  it("delete_transaction: 写真つきは案内つきで断り、delete_photos: true で消す", async () => {
    const added = text(await callTool("add_transactions", { transactions: [{ date: "2026-10-01", amount: 500, merchant: "Aストア", category: "食費" }] }));
    const id = added.registered[0].id as string;
    await testEnv().PHOTOS.put("photos/2026/m1", new Uint8Array([0xff, 0xd8, 0xff, 0]), { httpMetadata: { contentType: "image/jpeg" } });
    await testEnv()
      .DB.prepare("INSERT INTO attachments (id, r2_key, transaction_id, created_at) VALUES ('m1', 'photos/2026/m1', ?, '2026-10-01T00:00:00.000Z')")
      .bind(id)
      .run();

    const refused = await callTool("delete_transaction", { id });
    expect(refused.body.result.isError).toBe(true);
    expect(text(refused).errors[0].message).toContain("写真1枚が紐づいています。delete_photos で写真もいっしょに削除できます");

    const ok = await callTool("delete_transaction", { id, delete_photos: true });
    expect(ok.body.result.isError).toBeFalsy();
    expect(text(ok).deleted).toMatchObject({ photos: 1 });
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(0);
  });

  it("カテゴリを省略すると、同じ店の直近のカテゴリを引き継いで applied_default_category で知らせる", async () => {
    await callTool("add_transactions", { transactions: [{ date: "2026-10-01", amount: 300, merchant: "Aストア", category: "食費" }] });
    const res = text(await callTool("add_transactions", { transactions: [{ date: "2026-10-02", amount: 400, merchant: "Aストア", items: [{ name: "B", amount: 400 }] }] }));
    expect(res.registered[0]).toMatchObject({ category: "食費", applied_default_category: "食費" });
  });
});
