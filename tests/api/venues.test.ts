import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

const rec = { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 4 };

describe("会場・スクリーンのAPI", () => {
  it("座席の記録の POST で会場・スクリーンが作られ、created_venue / created_screen が返る。応答は従来の形に venue_id などが加わる", async () => {
    const first = await json(await send("POST", "/api/seat-records", rec));
    expect(first).toMatchObject({
      ok: true,
      created_venue: true,
      created_screen: true,
      seat_record: { ...rec, title: null, screen_note: null, venue_id: expect.any(String), screen_id: expect.any(String) },
    });
    const second = await json(await send("POST", "/api/seat-records", { ...rec, seat: "G-1" }));
    expect(second).toMatchObject({ created_venue: false, created_screen: false });
    const day = await json(await call("/api/day/2026-10-10"));
    expect(day.seat_records).toHaveLength(2);
    expect(day.seat_records[0]).toMatchObject({ venue: "A映画館", screen: "スクリーン5", screen_note: null });
  });

  it("GET /api/venues: 会場ごとにスクリーンと件数・平均評価", async () => {
    await send("POST", "/api/seat-records", rec);
    await send("POST", "/api/seat-records", { ...rec, seat: "G-1", rating: 2 });
    await send("POST", "/api/seat-records", { ...rec, venue: "B劇場", screen: undefined, rating: undefined });
    const res = await call("/api/venues");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, count: 2 });
    expect(body.venues[0]).toMatchObject({ name: "A映画館", record_count: 2, avg_rating: 3, screens: [{ name: "スクリーン5", note: null, record_count: 2, avg_rating: 3 }] });
    expect(body.venues[1]).toMatchObject({ name: "B劇場", record_count: 1, avg_rating: null, screens: [] });
  });

  it("PATCH /api/venues/:id で会場名を変える。記録の venue も変わる", async () => {
    const add = await json(await send("POST", "/api/seat-records", rec));
    const res = await send("PATCH", `/api/venues/${add.seat_record.venue_id}`, { name: "A映画館(梅田)" });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, venue: { name: "A映画館(梅田)", record_count: 1 } });
    expect((await json(await call("/api/seat-records?venue=" + encodeURIComponent("A映画館(梅田)")))).count).toBe(1);
  });

  it("PATCH /api/screens/:id で名前と note を変える(null で note 消去)。日詳細の screen_note に出る", async () => {
    const add = await json(await send("POST", "/api/seat-records", rec));
    const id = add.seat_record.screen_id as string;
    const res = await send("PATCH", `/api/screens/${id}`, { note: "前方は首が疲れる" });
    expect(await json(res)).toMatchObject({ ok: true, screen: { id, name: "スクリーン5", note: "前方は首が疲れる" } });
    expect((await json(await call("/api/day/2026-10-10"))).seat_records[0]).toMatchObject({ screen: "スクリーン5", screen_note: "前方は首が疲れる" });
    expect(await json(await send("PATCH", `/api/screens/${id}`, { name: "スクリーン5(IMAX)", note: null }))).toMatchObject({ ok: true, screen: { name: "スクリーン5(IMAX)", note: null } });
  });

  it("エラー: 存在しない id は404、検証エラー・名前の重複は400、JSON以外は415、壊れたJSONは400、別オリジンは403、長すぎる id は404", async () => {
    const a = await json(await send("POST", "/api/seat-records", rec));
    const b = await json(await send("POST", "/api/seat-records", { ...rec, venue: "B劇場", screen: "ホール" }));
    expect((await send("PATCH", "/api/venues/none", { name: "C" })).status).toBe(404);
    expect((await send("PATCH", "/api/screens/none", { name: "C" })).status).toBe(404);
    expect((await send("PATCH", `/api/venues/${a.seat_record.venue_id}`, { name: "B劇場" })).status).toBe(400);
    expect((await send("PATCH", `/api/venues/${a.seat_record.venue_id}`, {})).status).toBe(400);
    expect((await send("PATCH", `/api/screens/${a.seat_record.screen_id}`, {})).status).toBe(400);
    expect((await send("PATCH", `/api/screens/${a.seat_record.screen_id}`, { note: "あ".repeat(201) })).status).toBe(400);
    expect((await send("PATCH", `/api/screens/${b.seat_record.screen_id}`, { name: "ホール" })).status).toBe(200);
    expect((await call("/api/venues/x", { method: "PATCH", body: "x=1", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/screens/x", { method: "PATCH", body: "{", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await send("PATCH", `/api/venues/${a.seat_record.venue_id}`, { name: "Z" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await send("PATCH", `/api/venues/${"a".repeat(65)}`, { name: "Z" })).status).toBe(404);
    expect((await send("PATCH", `/api/screens/${"a".repeat(65)}`, { name: "Z" })).status).toBe(404);
  });

  it("削除用のAPIはない", async () => {
    const a = await json(await send("POST", "/api/seat-records", rec));
    expect((await send("DELETE", `/api/venues/${a.seat_record.venue_id}`)).status).toBe(404);
    expect((await send("DELETE", `/api/screens/${a.seat_record.screen_id}`)).status).toBe(404);
  });
});
