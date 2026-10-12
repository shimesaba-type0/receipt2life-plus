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

describe("MCP 座席の記録のツール", () => {
  it("tools/list は26個で、座席の4ツールの説明が具体的", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: { required?: string[]; properties: Record<string, unknown> } }[];
    expect(tools).toHaveLength(26);
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName("add_seat_record").inputSchema.required).toEqual(["date", "venue", "seat"]);
    expect(byName("add_seat_record").description).toContain("list_seat_records");
    expect(byName("add_seat_record").description).toContain("表記");
    expect(byName("list_seat_records").description).toContain("rating");
    expect(byName("list_seat_records").description).toContain("次の席選び");
    expect(byName("list_seat_records").description).toContain("要約");
    expect(Object.keys(byName("list_seat_records").inputSchema.properties).sort()).toEqual(
      ["from", "limit", "max_rating", "min_rating", "screen", "seat", "to", "transaction_id", "venue"],
    );
    expect(byName("update_seat_record").inputSchema.required).toEqual(["id"]);
    expect(byName("delete_seat_record").inputSchema.required).toEqual(["id"]);
    for (const n of ["add_seat_record", "list_seat_records", "update_seat_record", "delete_seat_record"]) expect(byName(n).description.length).toBeGreaterThan(80);
  });

  it("add → list(絞り込みと summary)→ update → delete の往復", async () => {
    const add = await callTool("add_seat_record", { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 2, note: "前すぎて首が疲れた" });
    expect(add.body.result.isError).toBeFalsy();
    const added = text(add);
    expect(added).toMatchObject({ ok: true, seat_record: { venue: "A映画館", seat: "F-5", rating: 2, note: "前すぎて首が疲れた" } });
    await callTool("add_seat_record", { date: "2026-10-20", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 3 });

    const list = text(await callTool("list_seat_records", { venue: "A映画館", seat: "F-5" }));
    expect(list).toMatchObject({ ok: true, count: 2, summary: [{ venue: "A映画館", screen: "スクリーン5", seat: "F-5", count: 2, rated_count: 2, avg_rating: 2.5 }] });
    expect(list.records[0].date).toBe("2026-10-20");
    expect(text(await callTool("list_seat_records", {}))).toMatchObject({ count: 2 });
    expect(text(await callTool("list_seat_records", { min_rating: 3 }))).toMatchObject({ count: 1 });

    const upd = text(await callTool("update_seat_record", { id: added.seat_record.id, rating: 1, note: null }));
    expect(upd).toMatchObject({ ok: true, seat_record: { rating: 1, note: null } });

    expect(text(await callTool("delete_seat_record", { id: added.seat_record.id }))).toMatchObject({ ok: true });
    expect(text(await callTool("list_seat_records", {}))).toMatchObject({ count: 1 });
    const gone = await callTool("delete_seat_record", { id: added.seat_record.id });
    expect(gone.body.result.isError).toBe(true);
  });

  it("範囲外の rating・存在しない取引・存在しない id は、直し方が分かるエラー", async () => {
    const bad = await callTool("add_seat_record", { date: "2026-10-10", venue: "A映画館", seat: "F-5", rating: 6 });
    expect(bad.body.result.isError).toBe(true);
    // 入力の形(範囲)は MCP の入力定義で弾かれ、メッセージに項目名と範囲が出る
    expect(bad.body.result.content[0].text).toContain("rating");
    expect(bad.body.result.content[0].text).toContain("1〜5");
    const noTx = await callTool("add_seat_record", { date: "2026-10-10", venue: "A映画館", seat: "F-5", transaction_id: "none" });
    expect(noTx.body.result.isError).toBe(true);
    const noId = await callTool("update_seat_record", { id: "none", rating: 3 });
    expect(noId.body.result.isError).toBe(true);
    expect(text(noId).errors[0].message).toContain("list_seat_records");
  });
});
