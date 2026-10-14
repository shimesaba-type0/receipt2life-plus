import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string) => app.request(`http://localhost${path}`, undefined, local);
const send = (method: string, path: string, body: unknown) => app.request(`http://localhost${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } }, local);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("商品のAPI", () => {
  it("明細の商品の情報を登録し、一覧と履歴で引ける。不正な入力は400", async () => {
    const added = await send("POST", "/api/transactions", {
      transactions: [{ date: "2026-10-05", amount: 396, merchant: "Aストア", items: [{ name: "牛乳 1L", amount: 396, product: "牛乳", quantity: 2, content_amount: 1000, content_unit: "ml" }] }],
    });
    expect(added.status).toBe(200);
    const detail = await json(await call(`/api/transactions/${(await json(added)).registered[0].id}`));
    expect(detail.transaction.items[0]).toMatchObject({ product: "牛乳", unit_price: { per_unit: 0.198, unit: "ml" } });

    const list = await json(await call("/api/products?from=2026-10-01&to=2026-10-31"));
    expect(list).toMatchObject({ ok: true, total: 1, products: [{ product: "牛乳", quantity: 2, amount: 396, has_unit_price: true }] });
    const hist = await json(await call(`/api/products/history?product=${encodeURIComponent("牛乳")}`));
    expect(hist).toMatchObject({ ok: true, product: "牛乳", quantity: 2, months: [{ month: "2026-10", quantity: 2 }], unit_price: { unit: "ml" } });

    expect((await call("/api/products/history")).status).toBe(400);
    expect((await call("/api/products?limit=0")).status).toBe(400);
    const bad = await send("POST", "/api/transactions", { transactions: [{ date: "2026-10-05", amount: 100, items: [{ name: "x", amount: 100, content_amount: 5 }] }] });
    expect(bad.status).toBe(400);
  });
});
