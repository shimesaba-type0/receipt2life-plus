import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const send = (method: string, path: string, body?: unknown) =>
  app.request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }, local);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("API サブスク・固定費", () => {
  it("未認証は401", async () => {
    expect((await app.request("http://example.test/api/subscriptions", {}, { DB: testEnv().DB })).status).toBe(401);
  });

  it("POST → GET → PATCH → DELETE", async () => {
    const added = await json(await send("POST", "/api/subscriptions", { name: "ダミー保険", kind: "insurance", amount: 24000, period: "yearly", billing_month: 6 }));
    expect(added).toMatchObject({ ok: true, subscription: { monthly_equivalent: 2000, kind: "insurance" } });
    const id = added.subscription.id as string;

    const list = await json(await send("GET", "/api/subscriptions"));
    expect(list).toMatchObject({ ok: true, count: 1, totals: { monthly: 2000, yearly: 24000 } });
    expect((await json(await send("GET", "/api/subscriptions?kind=subscription"))).count).toBe(0);
    expect((await json(await send("GET", "/api/subscriptions?active=false"))).count).toBe(0);
    expect((await json(await send("GET", "/api/subscriptions?active=true"))).count).toBe(1);

    const patched = await json(await send("PATCH", `/api/subscriptions/${id}`, { amount: 26400, note: "更新" }));
    expect(patched).toMatchObject({ ok: true, subscription: { amount: 26400, previous_amount: 24000, note: "更新" } });

    const del = await json(await send("DELETE", `/api/subscriptions/${id}`));
    expect(del).toMatchObject({ ok: true });
    expect((await send("DELETE", `/api/subscriptions/${id}`)).status).toBe(404);
    expect((await send("PATCH", `/api/subscriptions/${id}`, { amount: 1 })).status).toBe(404);
  });

  it("不正な入力は400、壊れたJSONも400", async () => {
    expect((await send("POST", "/api/subscriptions", { name: "A", amount: 100, period: "weekly" })).status).toBe(400);
    expect((await send("GET", "/api/subscriptions?active=maybe")).status).toBe(400);
    const res = await app.request("http://localhost/api/subscriptions", { method: "POST", body: "{", headers: { "content-type": "application/json" } }, local);
    expect(res.status).toBe(400);
  });

  it("外貨(USD)の登録・一覧・更新・円への戻し", async () => {
    const added = await json(await send("POST", "/api/subscriptions", { name: "ダミーAI", currency: "USD", foreign_amount: 20, exchange_rate: 150, period: "monthly", billing_day: 23 }));
    expect(added).toMatchObject({ ok: true, subscription: { currency: "USD", foreign_amount: 20, exchange_rate: 150, amount: 3000, amount_is_estimate: true, billing_day: 23 } });
    const id = added.subscription.id as string;
    expect((await json(await send("GET", "/api/subscriptions"))).totals).toMatchObject({ monthly: 3000, yearly: 36000 });
    const up = await json(await send("PATCH", `/api/subscriptions/${id}`, { exchange_rate: 155.5 }));
    expect(up).toMatchObject({ ok: true, subscription: { amount: 3110, foreign_amount: 20 } });
    expect((await send("PATCH", `/api/subscriptions/${id}`, { amount: 100 })).status).toBe(400);
    expect((await send("POST", "/api/subscriptions", { name: "B", currency: "USD", amount: 100, period: "monthly" })).status).toBe(400);
    const back = await json(await send("PATCH", `/api/subscriptions/${id}`, { currency: "JPY", amount: 3100 }));
    expect(back).toMatchObject({ ok: true, subscription: { currency: "JPY", foreign_amount: null, amount: 3100, previous_amount: 3110 } });
  });
});

