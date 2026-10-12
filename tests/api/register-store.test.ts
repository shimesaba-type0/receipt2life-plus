import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

// API と register_no / store_code。値はダミー
const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const send = (method: string, path: string, body?: unknown) =>
  app.request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }, local);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("API のレジ番号・店番号", () => {
  it("POST → GET → PATCH(null で空)", async () => {
    const date = todayJst();
    const added = await json(await send("POST", "/api/transactions", { transactions: [{ date, amount: 900, merchant: "Aストア", register_no: " 0005", store_code: "007832" }] }));
    expect(added.registered[0]).toMatchObject({ register_no: "0005", store_code: "007832" });
    const id = added.registered[0].id as string;
    expect((await json(await send("GET", `/api/transactions/${id}`))).transaction).toMatchObject({ register_no: "0005", store_code: "007832" });
    expect((await json(await send("GET", `/api/day/${date}`))).transactions[0]).toMatchObject({ register_no: "0005" });
    const patch = await json(await send("PATCH", `/api/transactions/${id}`, { register_no: null }));
    expect(patch).toMatchObject({ ok: true, transaction: { register_no: null, store_code: "007832" } });
  });

  it("長すぎる値は400", async () => {
    const res = await send("POST", "/api/transactions", { transactions: [{ amount: 100, store_code: "9".repeat(31) }] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await json(res))).toContain("store_code");
  });
});
