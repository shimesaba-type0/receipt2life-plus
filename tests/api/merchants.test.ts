import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

// GET /api/merchants。店名・電話はダミー
const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

async function seed() {
  const date = todayJst();
  const res = await call("/api/transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      transactions: [
        { date, amount: 500, merchant: "Aストア", category: "食費", account: "現金", merchant_phone: "03-0000-1111" },
        { date, amount: 600, merchant: "Aストア", category: "食費", allow_duplicate: true },
        { date, amount: 700, merchant: "Bカフェ", category: "食費" },
      ],
    }),
  });
  expect(res.status).toBe(200);
}

describe("GET /api/merchants", () => {
  it("店名ごとの候補を返し、q・category・limit で絞れる。no-store", async () => {
    await seed();
    const res = await call("/api/merchants");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const all = await json(res);
    expect(all.ok).toBe(true);
    expect(all.merchants.map((m: { merchant: string }) => m.merchant)).toEqual(["Aストア", "Bカフェ"]);
    expect(all.merchants[0]).toMatchObject({ count: 2, category: "食費", account: "現金", phone: "03-0000-1111", address: null, invoice_number: null });

    expect((await json(await call("/api/merchants?q=0000111"))).merchants.map((m: { merchant: string }) => m.merchant)).toEqual(["Aストア"]);
    expect((await json(await call(`/api/merchants?q=${encodeURIComponent("かふぇ")}`))).merchants).toHaveLength(1);
    expect((await json(await call(`/api/merchants?category=${encodeURIComponent("食費")}&limit=1`))).merchants).toHaveLength(1);
    expect((await json(await call("/api/merchants?q="))).merchants).toHaveLength(2);
  });

  it("limit が不正なら400で、項目名つきの日本語エラー", async () => {
    for (const q of ["limit=0", "limit=21", "limit=abc", "limit=1.5"]) {
      const res = await call(`/api/merchants?${q}`);
      expect(res.status, q).toBe(400);
      const body = await json(res);
      expect(body.ok).toBe(false);
      expect(body.errors[0].field).toBe("limit");
    }
  });

  it("POST など GET 以外は受け付けない", async () => {
    const res = await call("/api/merchants", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
