import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const url = (path: string) => `http://localhost${path}`;
const call = (path: string, init?: RequestInit) => app.request(url(path), init, local);
const send = (method: string, path: string, body?: unknown) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

// ブラウザと同じく、Content-Length つきの multipart を作る
async function multipart(form: FormData): Promise<RequestInit> {
  const res = new Response(form);
  const body = await res.arrayBuffer();
  return { method: "POST", body, headers: { "content-type": res.headers.get("content-type")!, "content-length": String(body.byteLength) } };
}

async function upload(bytes: Uint8Array, fields: Record<string, string>, name = "x.jpg", type = "image/jpeg") {
  const form = new FormData();
  form.set("file", new File([bytes.slice()], name, { type }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return call("/api/photos", await multipart(form));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("認証と未定義パス", () => {
  it("未認証は401", async () => {
    const res = await app.request(url("/api/home"), {}, { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS });
    expect(res.status).toBe(401);
  });

  it("未定義の /api/* は404のJSON", async () => {
    const res = await call("/api/nothing");
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ ok: false, errors: [{ field: "path" }] });
  });
});

describe("取引", () => {
  it("追加 → 更新(null で空) → 日別 → 削除", async () => {
    const date = todayJst();
    const add = await send("POST", "/api/transactions", { transactions: [{ date, amount: 800, merchant: "A店", category: "食費", memo: "x" }] });
    expect(add.status).toBe(200);
    const added = await json(add);
    expect(added).toMatchObject({ ok: true, registered: [{ amount: 800 }], skipped_duplicates: [] });
    const id = added.registered[0].id as string;

    const patch = await send("PATCH", `/api/transactions/${id}`, { amount: 900, memo: null });
    expect(patch.status).toBe(200);
    expect(await json(patch)).toMatchObject({ ok: true, transaction: { id, amount: 900, memo: null }, warnings: [] });

    const day = await json(await call(`/api/day/${date}`));
    expect(day).toMatchObject({ ok: true, date, total: 900, count: 1 });

    const del = await send("DELETE", `/api/transactions/${id}`);
    expect(await json(del)).toMatchObject({ ok: true, deleted: { transaction: { id }, items: 0, photos: 0, links: 0 } });
    expect((await send("DELETE", `/api/transactions/${id}`)).status).toBe(404);
  });

  it("検証エラーは400で index つき", async () => {
    const res = await send("POST", "/api/transactions", { transactions: [{ amount: -1 }] });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, errors: [{ index: 0, field: "amount" }] });
  });

  it("壊れたJSON・配列は400", async () => {
    const bad = await call("/api/transactions", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ ok: false, errors: [{ field: "body" }] });
    expect((await send("POST", "/api/transactions", [])).status).toBe(400);
  });

  it("存在しない id の更新は404、本文の id は無視されずパスが優先", async () => {
    expect((await send("PATCH", "/api/transactions/nope", { amount: 1 })).status).toBe(404);
  });

  it("写真が紐づく取引の削除は400", async () => {
    const added = await json(await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 100, merchant: "A店", category: "食費" }] }));
    const id = added.registered[0].id as string;
    expect((await upload(JPEG, { transaction_id: id })).status).toBe(200);
    const res = await send("DELETE", `/api/transactions/${id}`);
    expect(res.status).toBe(400);
  });
});

describe("出来事", () => {
  it("追加 → 更新 → 削除", async () => {
    const add = await json(await send("POST", "/api/events", { title: "出張", start_date: "2026-10-03", end_date: "2026-10-05" }));
    expect(add).toMatchObject({ ok: true, event: { title: "出張", color: "blue" } });
    const id = add.event.id as string;

    const patch = await json(await send("PATCH", `/api/events/${id}`, { end_date: null, color: "red" }));
    expect(patch).toMatchObject({ ok: true, event: { end_date: null, color: "red" } });

    const cal = await json(await call("/api/calendar?month=2026-10"));
    expect(cal).toMatchObject({ ok: true, month: "2026-10", days: [], events: [{ id }] });

    expect(await json(await send("DELETE", `/api/events/${id}`))).toMatchObject({ ok: true, deleted: { id } });
    expect((await send("DELETE", `/api/events/${id}`)).status).toBe(404);
    expect((await send("PATCH", `/api/events/${id}`, { title: "x" })).status).toBe(404);
  });

  it("検証エラーは400。写真つきの出来事は削除できない", async () => {
    expect((await send("POST", "/api/events", { title: "", start_date: "2026-10-03" })).status).toBe(400);
    const add = await json(await send("POST", "/api/events", { title: "旅行", start_date: "2026-10-03" }));
    const id = add.event.id as string;
    expect((await upload(PNG, { event_id: id }, "a.png", "image/png")).status).toBe(200);
    expect((await send("DELETE", `/api/events/${id}`)).status).toBe(400);
  });
});

describe("読み取り", () => {
  it("home / calendar / categories の形", async () => {
    const home = await json(await call("/api/home"));
    expect(home).toMatchObject({ ok: true, today: { total: 0 }, groups: [], needs_review: 0, recent: [], discounts: { month_total: 0, month_line_count: 0 } });
    expect((await json(await call("/api/calendar"))).month).toBe(todayJst().slice(0, 7));
    const cats = await json(await call("/api/categories"));
    expect(cats.ok).toBe(true);
    expect(cats.categories.length).toBeGreaterThan(0);
    expect(cats.accounts.length).toBeGreaterThan(0);
  });

  it("discounts: 割引の集計。ホームの discounts と同じ数字、不正な値は400、no-store", async () => {
    const date = todayJst();
    await send("POST", "/api/transactions", {
      transactions: [{ date, amount: 900, merchant: "A店", category: "食費", items: [{ name: "品", amount: 1000 }, { name: "値引", amount: -100 }] }],
    });
    const res = await call("/api/discounts");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(res)).toMatchObject({ ok: true, group_by: "none", total: 100, line_count: 1, receipt_count: 1, spend_total: 900, rows: [] });
    const byMerchant = await json(await call(`/api/discounts?from=${date}&to=${date}&group_by=merchant&unknown=`));
    expect(byMerchant).toMatchObject({ ok: true, rows: [{ key: "A店", total: 100, line_count: 1, receipt_count: 1 }] });
    // 空のクエリは省略扱い
    expect(await json(await call("/api/discounts?from=&to=&group_by="))).toMatchObject({ ok: true, total: 100 });
    const home = await json(await call("/api/home"));
    expect(home.discounts).toEqual({ month_total: 100, month_line_count: 1 });
    expect((await call("/api/discounts?group_by=group")).status).toBe(400);
    expect((await call("/api/discounts?from=2026-10-31&to=2026-10-01")).status).toBe(400);
    expect((await call("/api/discounts?from=abc")).status).toBe(400);
  });

  it("不正な month / date は400", async () => {
    expect((await call("/api/calendar?month=2026-13")).status).toBe(400);
    expect((await call("/api/day/2026-02-30")).status).toBe(400);
    expect((await call("/api/day/abc")).status).toBe(400);
  });
});

describe("写真", () => {
  it("アップロード → 配信 → 削除", async () => {
    const res = await upload(JPEG, { date: "2026-10-10", caption: "朝" });
    expect(res.status).toBe(200);
    const { photo } = await json(res);
    expect(photo).toMatchObject({ date: "2026-10-10", caption: "朝", url: `/api/photos/${photo.id}` });

    const day = await json(await call("/api/day/2026-10-10"));
    expect(day.photos).toHaveLength(1);

    const got = await call(photo.url);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(JPEG);

    const del = await json(await send("DELETE", photo.url));
    expect(del).toMatchObject({ ok: true, deleted: { id: photo.id } });
    expect((await call(photo.url)).status).toBe(404);
    expect((await send("DELETE", photo.url)).status).toBe(404);
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(0);
  });

  it("申告のContent-Typeと拡張子ではなく中身で判定する", async () => {
    // 中身はHTML。image/jpeg と .jpg を名乗っても通らない
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const res = await upload(html, { date: "2026-10-10" }, "evil.jpg", "image/jpeg");
    expect(res.status).toBe(400);
    // 中身がPNGなら、.txt / text/plain でも保存時の値は image/png
    const ok = await upload(PNG, { date: "2026-10-10" }, "a.txt", "text/plain");
    expect(ok.status).toBe(200);
    const { photo } = await json(ok);
    expect((await call(photo.url)).headers.get("content-type")).toBe("image/png");
  });

  it("5MBを超えると413(Content-Length で断る場合と、ファイルサイズで断る場合)", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect((await upload(big, { date: "2026-10-10" })).status).toBe(413);
    const huge = await call("/api/photos", {
      method: "POST",
      headers: { "content-length": String(10 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" },
      body: "x",
    });
    expect(huge.status).toBe(413);
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(0);
  });

  it("入力エラーは400", async () => {
    expect((await upload(JPEG, {})).status).toBe(400); // 紐づけ先なし
    expect((await upload(JPEG, { transaction_id: "nope" })).status).toBe(400); // 参照先なし
    expect((await upload(JPEG, { event_id: "nope" })).status).toBe(400);
    expect((await upload(JPEG, { date: "2026-13-01" })).status).toBe(400);
    const noFile = new FormData();
    noFile.set("date", "2026-10-10");
    expect((await call("/api/photos", await multipart(noFile))).status).toBe(400);
    expect((await call("/api/photos", { method: "POST", body: "plain", headers: { "content-length": "5" } })).status).toBe(400);
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(0);
  });
});

describe("書き込みの保護(CSRF・Content-Type)", () => {
  const body = JSON.stringify({ title: "出張", start_date: "2026-10-03" });
  const jsonH = { "content-type": "application/json" };
  const post = (headers: Record<string, string>, path = "/api/events") => call(path, { method: "POST", body, headers });

  it("Origin が別なら403、同じなら通る", async () => {
    expect((await post({ ...jsonH, origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ ...jsonH, origin: "null" })).status).toBe(403);
    expect((await post({ ...jsonH, origin: "http://localhost" })).status).toBe(200);
  });

  it("Origin が無ければ Sec-Fetch-Site を見る(same-origin / none 以外は403)", async () => {
    expect((await post({ ...jsonH, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ ...jsonH, "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await post({ ...jsonH, "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await post({ ...jsonH, "sec-fetch-site": "none" })).status).toBe(200);
  });

  it("PATCH / DELETE / 写真 / import も同じ検査を受ける", async () => {
    const evil = { origin: "https://evil.example" };
    expect((await call("/api/events/x", { method: "DELETE", headers: evil })).status).toBe(403);
    expect((await call("/api/events/x", { method: "PATCH", body: "{}", headers: { ...jsonH, ...evil } })).status).toBe(403);
    expect((await call("/api/photos/x", { method: "DELETE", headers: evil })).status).toBe(403);
    expect((await call("/import", { method: "POST", body: "", headers: evil })).status).toBe(403);
    expect((await call("/import", { method: "POST", body: "", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    const form = new FormData();
    form.set("file", new File([JPEG.slice()], "a.jpg"));
    form.set("date", "2026-10-10");
    const init = await multipart(form);
    expect((await call("/api/photos", { ...init, headers: { ...(init.headers as object), ...evil } })).status).toBe(403);
    // 読み取りは対象外
    expect((await call("/api/home", { headers: evil })).status).toBe(200);
  });

  it("JSON のルートは application/json 以外だと415(charset つきは可)", async () => {
    expect((await post({})).status).toBe(415);
    expect((await post({ "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ "content-type": "application/x-www-form-urlencoded" }, "/api/transactions")).status).toBe(415);
    expect((await call("/api/events/x", { method: "PATCH", body: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await post({ "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("MCP は対象外(Origin が違っても403にならない)", async () => {
    const res = await call("/mcp", { method: "POST", body: "{}", headers: { ...jsonH, origin: "https://client.example", accept: "application/json, text/event-stream" } });
    expect(res.status).not.toBe(403);
  });

  it("Content-Length が無い写真アップロードは411", async () => {
    const form = new FormData();
    form.set("file", new File([JPEG.slice()], "a.jpg"));
    form.set("date", "2026-10-10");
    const init = await multipart(form);
    const res = await call("/api/photos", { method: "POST", body: init.body, headers: { "content-type": (init.headers as Record<string, string>)["content-type"]! } });
    expect(res.status).toBe(411);
    expect((await testEnv().PHOTOS.list()).objects).toHaveLength(0);
  });

  it("JSON応答は no-store、写真の配信には CORP がつく。長い id は64文字までしか出さない", async () => {
    expect((await call("/api/home")).headers.get("cache-control")).toBe("private, no-store");
    expect((await call("/api/nothing")).headers.get("cache-control")).toBe("private, no-store");
    const { photo } = await json(await upload(JPEG, { date: "2026-10-10" }));
    const got = await call(photo.url);
    expect(got.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(got.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const long = "a".repeat(200);
    const res = await call("/api/photos/" + long);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect((await call("/api/photos/missing")).headers.get("cache-control")).toBe("private, no-store");
  });
});
