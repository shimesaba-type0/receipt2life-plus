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

const rec = { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 4, note: "見やすい" };

describe("座席の記録のAPI", () => {
  it("追加 → 日詳細に出る → 更新 → 削除", async () => {
    const add = await send("POST", "/api/seat-records", rec);
    expect(add.status).toBe(200);
    expect(add.headers.get("cache-control")).toBe("private, no-store");
    const added = await json(add);
    expect(added).toMatchObject({ ok: true, seat_record: { ...rec, transaction_id: null, created_at: expect.any(String) } });
    const id = added.seat_record.id as string;

    const day = await json(await call("/api/day/2026-10-10"));
    expect(day.seat_records).toHaveLength(1);
    expect(day.seat_records[0]).toMatchObject({ id, venue: "A映画館", seat: "F-5", rating: 4 });
    expect((await json(await call("/api/day/2026-10-11"))).seat_records).toEqual([]);

    const patch = await send("PATCH", `/api/seat-records/${id}`, { rating: null, note: "首が疲れた", screen: null });
    expect(await json(patch)).toMatchObject({ ok: true, seat_record: { id, rating: null, note: "首が疲れた", screen: null, seat: "F-5" } });

    const del = await send("DELETE", `/api/seat-records/${id}`);
    expect(del.status).toBe(200);
    expect((await json(await call("/api/day/2026-10-10"))).seat_records).toEqual([]);
    expect((await send("DELETE", `/api/seat-records/${id}`)).status).toBe(404);
  });

  it("GET の絞り込み: date(その日だけ)/ venue / screen / seat / min_rating / max_rating / from / to / limit", async () => {
    await send("POST", "/api/seat-records", rec);
    await send("POST", "/api/seat-records", { ...rec, date: "2026-10-12", seat: "G-1", rating: 2, note: undefined });
    await send("POST", "/api/seat-records", { ...rec, date: "2026-10-12", venue: "B劇場", screen: undefined, seat: "1列3番", rating: undefined });

    const all = await json(await call("/api/seat-records"));
    expect(all).toMatchObject({ ok: true, count: 3, truncated: false });
    expect(all.records.map((r: { date: string }) => r.date)).toEqual(["2026-10-12", "2026-10-12", "2026-10-10"]);
    expect(all.records[2].seat).toBe("F-5");
    expect(all.summary).toHaveLength(3);

    expect((await json(await call("/api/seat-records?date=2026-10-12"))).count).toBe(2);
    expect((await json(await call("/api/seat-records?date=2026-10-12&venue=" + encodeURIComponent("A映画館")))).count).toBe(1);
    expect((await json(await call("/api/seat-records?screen=" + encodeURIComponent("スクリーン5")))).count).toBe(2);
    expect((await json(await call("/api/seat-records?seat=F-5"))).count).toBe(1);
    expect((await json(await call("/api/seat-records?min_rating=3"))).count).toBe(1);
    expect((await json(await call("/api/seat-records?max_rating=3"))).count).toBe(1);
    expect((await json(await call("/api/seat-records?from=2026-10-11&to=2026-10-31"))).count).toBe(2);
    const limited = await json(await call("/api/seat-records?limit=1"));
    expect(limited).toMatchObject({ count: 3, truncated: true });
    expect(limited.records).toHaveLength(1);
    expect(limited.summary).toHaveLength(3);
  });

  it("GET の不正な指定は400", async () => {
    for (const q of ["min_rating=abc", "min_rating=9", "limit=0", "date=2026-02-30", "from=x"]) {
      const res = await call(`/api/seat-records?${q}`);
      expect(res.status, q).toBe(400);
      expect(await json(res)).toMatchObject({ ok: false });
    }
  });

  it("検証エラーは400、存在しない id は404", async () => {
    const bad = await send("POST", "/api/seat-records", { ...rec, rating: 6 });
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ ok: false, errors: [{ field: "rating" }] });
    expect((await send("POST", "/api/seat-records", { date: "2026-10-10", venue: "A映画館" })).status).toBe(400);
    expect((await send("POST", "/api/seat-records", { ...rec, transaction_id: "nope" })).status).toBe(400);
    expect((await send("PATCH", "/api/seat-records/none", { seat: "A-1" })).status).toBe(404);
    expect((await send("PATCH", "/api/seat-records/none", {})).status).toBe(404);
    const add = await json(await send("POST", "/api/seat-records", rec));
    expect((await send("PATCH", `/api/seat-records/${add.seat_record.id}`, {})).status).toBe(400);
    expect((await send("PATCH", `/api/seat-records/${add.seat_record.id}`, { rating: 0 })).status).toBe(400);
  });

  it("JSON以外は415、壊れたJSONは400、別オリジンは403、長すぎる id は404", async () => {
    expect((await call("/api/seat-records", { method: "POST", body: "x=1", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await call("/api/seat-records", { method: "POST", body: "{", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await send("POST", "/api/seat-records", rec, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/api/seat-records/x", { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await send("DELETE", `/api/seat-records/${"a".repeat(65)}`)).status).toBe(404);
  });

  it("取引に紐づけた記録は、取引を削除しても残り、紐づけだけ外れる", async () => {
    const tx = await json(await send("POST", "/api/transactions", { transactions: [{ date: "2026-10-10", amount: 1900, merchant: "A映画館", category: "娯楽" }] }));
    const txId = tx.registered[0].id as string;
    const add = await json(await send("POST", "/api/seat-records", { ...rec, transaction_id: txId }));
    expect(add.seat_record.transaction_id).toBe(txId);
    expect((await send("DELETE", `/api/transactions/${txId}`)).status).toBe(200);
    const day = await json(await call("/api/day/2026-10-10"));
    expect(day.seat_records).toMatchObject([{ id: add.seat_record.id, transaction_id: null }]);
  });
});
