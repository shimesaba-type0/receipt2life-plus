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
  it("tools/list は39個で、座席の4ツールの説明が具体的", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: { required?: string[]; properties: Record<string, unknown> } }[];
    expect(tools).toHaveLength(39);
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName("add_seat_record").inputSchema.required).toEqual(["date", "venue", "seat"]);
    expect(byName("add_seat_record").description).toContain("list_venues");
    expect(byName("add_seat_record").description).toContain("ユーザーに確認");
    expect(byName("add_seat_record").description).toContain("表記ゆれ");
    expect(byName("add_seat_record").description).toContain("created_venue");
    expect(byName("list_seat_records").description).toContain("rating");
    expect(byName("list_seat_records").description).toContain("次の席選び");
    expect(byName("list_seat_records").description).toContain("要約");
    expect(Object.keys(byName("list_seat_records").inputSchema.properties).sort()).toEqual(
      ["from", "limit", "max_rating", "min_rating", "screen", "seat", "seat_class", "title", "to", "transaction_id", "venue"],
    );
    expect(Object.keys(byName("add_seat_record").inputSchema.properties)).toContain("title");
    for (const n of ["add_seat_record", "update_seat_record"]) expect(Object.keys(byName(n).inputSchema.properties)).toContain("seat_class");
    for (const n of ["add_seat_record", "update_seat_record", "list_seat_records"]) {
      expect(byName(n).description).toContain("seat_class");
      expect(byName(n).description).toContain("席種");
    }
    expect(byName("add_seat_record").description).toContain("プレミアムシート、内野指定席、ボックスシート");
    expect(byName("add_seat_record").description).toContain("ホール・ブロック・エリア");
    expect(byName("add_seat_record").description).toContain("list_seat_records で seat_class を絞り込める");
    expect(byName("list_seat_records").description).toContain("seat_class(席種。部分一致");
    expect(Object.keys(byName("update_seat_record").inputSchema.properties)).toContain("title");
    for (const n of ["add_seat_record", "update_seat_record", "list_seat_records"]) {
      expect(byName(n).description).toContain("作品名");
      expect(byName(n).description).toContain("公演名");
    }
    expect(byName("add_seat_record").description).toContain("明細の品名とは別物");
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

  it("seat_class(席種)を登録・絞り込み・更新・消去できる", async () => {
    const added = text(await callTool("add_seat_record", { date: "2026-10-10", venue: "Aスタジアム", screen: "内野エリア", seat: "12列5番", seat_class: "内野指定席" }));
    expect(added.seat_record).toMatchObject({ seat_class: "内野指定席", screen: "内野エリア" });
    await callTool("add_seat_record", { date: "2026-10-11", venue: "Aスタジアム", seat: "自由", seat_class: "外野自由席" });
    expect(text(await callTool("list_seat_records", { seat_class: "内野" }))).toMatchObject({ count: 1, records: [{ seat_class: "内野指定席" }] });
    expect(text(await callTool("update_seat_record", { id: added.seat_record.id, seat_class: "ボックスシート" }))).toMatchObject({ seat_record: { seat_class: "ボックスシート" } });
    expect(text(await callTool("update_seat_record", { id: added.seat_record.id, seat_class: null }))).toMatchObject({ seat_record: { seat_class: null } });
  });

  it("title(作品名・公演名)を登録・絞り込み・更新・消去できる", async () => {
    const added = text(await callTool("add_seat_record", { date: "2026-10-10", venue: "A映画館", seat: "F-5", title: "ダミー作品A" }));
    expect(added.seat_record.title).toBe("ダミー作品A");
    await callTool("add_seat_record", { date: "2026-10-11", venue: "B劇場", seat: "1列3番", title: "ダミーライブ" });
    expect(text(await callTool("list_seat_records", { title: "作品" }))).toMatchObject({ count: 1, records: [{ title: "ダミー作品A" }] });
    expect(text(await callTool("update_seat_record", { id: added.seat_record.id, title: "ダミー作品B" }))).toMatchObject({ seat_record: { title: "ダミー作品B" } });
    expect(text(await callTool("update_seat_record", { id: added.seat_record.id, title: null }))).toMatchObject({ seat_record: { title: null } });
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
