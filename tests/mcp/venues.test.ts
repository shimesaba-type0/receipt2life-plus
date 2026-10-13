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

describe("MCP 会場・スクリーンのツール", () => {
  it("tools/list は35個で、list_venues / update_venue / update_screen があり、削除のツールはない。説明に使いどころがある", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string; inputSchema: { required?: string[]; properties: Record<string, unknown> } }[];
    expect(tools).toHaveLength(35);
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(Object.keys(byName("list_venues").inputSchema.properties)).toEqual([]);
    expect(byName("update_venue").inputSchema.required).toEqual(["id", "name"]);
    expect(byName("update_screen").inputSchema.required).toEqual(["id"]);
    expect(Object.keys(byName("update_screen").inputSchema.properties).sort()).toEqual(["id", "name", "note"]);
    expect(byName("list_venues").description).toContain("ユーザーに確認");
    expect(byName("update_screen").description).toContain("特徴");
    for (const n of ["list_venues", "update_venue", "update_screen"]) expect(byName(n).description.length).toBeGreaterThan(80);
    expect(tools.filter((t) => /venue|screen/.test(t.name) && t.name.startsWith("delete")).length).toBe(0);
  });

  it("add → list_venues → update_screen(note)→ update_venue → 記録に反映", async () => {
    const added = text(await callTool("add_seat_record", { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 2 }));
    expect(added).toMatchObject({ ok: true, created_venue: true, created_screen: true });
    expect(added.message).toContain("新規に作りました");
    const again = text(await callTool("add_seat_record", { date: "2026-10-11", venue: "A映画館", screen: "スクリーン5", seat: "F-6", rating: 4 }));
    expect(again).toMatchObject({ created_venue: false, created_screen: false });

    const listed = text(await callTool("list_venues", {}));
    expect(listed).toMatchObject({ ok: true, count: 1 });
    expect(listed.venues[0]).toMatchObject({ name: "A映画館", record_count: 2, avg_rating: 3, screens: [{ name: "スクリーン5", note: null, record_count: 2, avg_rating: 3 }] });

    const noted = await callTool("update_screen", { id: listed.venues[0].screens[0].id, note: "前方は首が疲れる" });
    expect(noted.body.result.isError).toBeFalsy();
    expect(text(noted)).toMatchObject({ ok: true, screen: { note: "前方は首が疲れる" } });
    const renamed = text(await callTool("update_venue", { id: listed.venues[0].id, name: "A映画館 梅田" }));
    expect(renamed).toMatchObject({ ok: true, venue: { name: "A映画館 梅田" } });

    const records = text(await callTool("list_seat_records", { venue: "A映画館 梅田" }));
    expect(records).toMatchObject({ count: 2 });
    expect(records.records[0]).toMatchObject({ venue: "A映画館 梅田", screen: "スクリーン5", screen_note: "前方は首が疲れる", venue_id: listed.venues[0].id });
    expect(text(await callTool("list_venues", {})).venues[0].screens[0].note).toBe("前方は首が疲れる");
  });

  it("エラーは isError で返る(存在しない id、名前の重複、指定なし)", async () => {
    const a = text(await callTool("add_seat_record", { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5" }));
    text(await callTool("add_seat_record", { date: "2026-10-10", venue: "B劇場", seat: "1列3番" }));
    const missing = await callTool("update_venue", { id: "none", name: "C" });
    expect(missing.body.result.isError).toBe(true);
    expect(text(missing).errors[0].message).toContain("という会場はありません");
    const dup = await callTool("update_venue", { id: a.seat_record.venue_id, name: "B劇場" });
    expect(dup.body.result.isError).toBe(true);
    const empty = await callTool("update_screen", { id: a.seat_record.screen_id });
    expect(empty.body.result.isError).toBe(true);
    expect((await callTool("update_screen", { id: "none", note: "x" })).body.result.isError).toBe(true);
  });
});
