import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

// 明細(items)の API。店名・品名はダミー
const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
const send = (method: string, path: string, body?: unknown) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

async function uploadPhoto(fields: Record<string, string>) {
  const form = new FormData();
  form.set("file", new File([JPEG.slice()], "x.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = new Response(form);
  const body = await res.arrayBuffer();
  return call("/api/photos", { method: "POST", body, headers: { "content-type": res.headers.get("content-type")!, "content-length": String(body.byteLength) } });
}

async function addWithItems() {
  const date = todayJst();
  const res = await send("POST", "/api/transactions", {
    transactions: [
      {
        date,
        amount: 1030,
        merchant: "Aストア",
        category: "食費",
        items: [
          { name: "牛乳", amount: 250 },
          { name: "パン", amount: 330 },
          { name: "洗剤", amount: 500, category: "日用品" },
          { name: "値引", amount: -50 },
        ],
      },
    ],
  });
  expect(res.status).toBe(200);
  const body = await json(res);
  return { date, id: body.registered[0].id as string, body };
}

describe("API の明細", () => {
  it("POST で明細つきで登録し、日の詳細と GET /api/transactions/:id に items が入る", async () => {
    const { date, id, body } = await addWithItems();
    expect(body.registered[0].items).toHaveLength(4);
    expect(body.registered[0].items[2]).toMatchObject({ position: 2, name: "洗剤", amount: 500, category: "日用品", tax_flag: null, memo: null });

    const day = await json(await call(`/api/day/${date}`));
    expect(day.transactions[0].items.map((i: { name: string }) => i.name)).toEqual(["牛乳", "パン", "洗剤", "値引"]);

    const detail = await call(`/api/transactions/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.headers.get("cache-control")).toBe("private, no-store");
    const d = await json(detail);
    expect(d).toMatchObject({ ok: true, transaction: { id, amount: 1030 }, photos: [], links: [], counts: { items: 4, photos: 0, links: 0 } });

    const home = await json(await call("/api/home"));
    expect(home.recent[0].items).toHaveLength(4);
  });

  it("存在しない取引の詳細は404", async () => {
    const res = await call("/api/transactions/no-such-id");
    expect(res.status).toBe(404);
  });

  it("合計が合わなければ400で、field: items と差額を返す", async () => {
    const res = await send("POST", "/api/transactions", { transactions: [{ amount: 1000, items: [{ name: "A", amount: 900 }] }] });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body).toMatchObject({ ok: false, errors: [{ index: 0, field: "items" }] });
    expect(body.errors[0].message).toContain("差額は100円");
  });

  it("PATCH の items は全置換・null で変えない・[] で全部消す。合わない金額の変更は400", async () => {
    const { id } = await addWithItems();
    const bad = await send("PATCH", `/api/transactions/${id}`, { amount: 2000 });
    expect(bad.status).toBe(400);
    expect((await json(bad)).errors[0].field).toBe("amount");

    const replaced = await json(await send("PATCH", `/api/transactions/${id}`, { amount: 2000, items: [{ name: "まとめ買い", amount: 2000 }] }));
    expect(replaced).toMatchObject({ ok: true, transaction: { amount: 2000, items: [{ position: 0, name: "まとめ買い", amount: 2000 }] } });

    const kept = await json(await send("PATCH", `/api/transactions/${id}`, { memo: "x", items: null }));
    expect(kept.transaction.items).toHaveLength(1);

    const cleared = await json(await send("PATCH", `/api/transactions/${id}`, { items: [] }));
    expect(cleared.transaction.items).toEqual([]);
  });

  it("DELETE: 写真つきは400で案内し、?delete_photos=1 で写真・明細もいっしょに消して件数を返す", async () => {
    const { date, id } = await addWithItems();
    const up = await uploadPhoto({ transaction_id: id, date });
    expect(up.status).toBe(200);
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(1);

    const refused = await send("DELETE", `/api/transactions/${id}`);
    expect(refused.status).toBe(400);
    expect((await json(refused)).errors[0].message).toContain("写真1枚が紐づいています。delete_photos で写真もいっしょに削除できます");

    const badFlag = await send("DELETE", `/api/transactions/${id}?delete_photos=yes`);
    expect(badFlag.status).toBe(400);

    const del = await send("DELETE", `/api/transactions/${id}?delete_photos=1`);
    expect(del.status).toBe(200);
    expect(await json(del)).toMatchObject({ ok: true, deleted: { transaction: { id }, items: 4, photos: 1, links: 0 } });
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(0);
    expect((await call(`/api/transactions/${id}`)).status).toBe(404);
  });

  it("書き込みの CSRF 対策は詳細の追加後も同じ(別オリジンの DELETE は403)", async () => {
    const { id } = await addWithItems();
    const res = await call(`/api/transactions/${id}?delete_photos=1`, { method: "DELETE", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});
