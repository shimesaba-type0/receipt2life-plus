import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("API の tax_flag", () => {
  it("POST で付け、日の詳細に含まれ、PATCH で変更・null で解除できる", async () => {
    const date = todayJst();
    const add = await send("POST", "/api/transactions", { transactions: [{ date, amount: 800, merchant: "A薬局", tax_flag: "medical" }] });
    expect(add.status).toBe(200);
    const added = await json(add);
    expect(added.registered[0].tax_flag).toBe("medical");
    const id = added.registered[0].id as string;

    const day = await json(await call(`/api/day/${date}`));
    expect(day.transactions[0]).toMatchObject({ id, tax_flag: "medical" });

    const patch = await json(await send("PATCH", `/api/transactions/${id}`, { tax_flag: "donation" }));
    expect(patch).toMatchObject({ ok: true, transaction: { tax_flag: "donation" } });

    const clear = await send("PATCH", `/api/transactions/${id}`, { tax_flag: null });
    expect(clear.status).toBe(200);
    expect((await json(clear)).transaction.tax_flag).toBeNull();
    expect((await json(await call(`/api/day/${date}`))).transactions[0].tax_flag).toBeNull();
  });

  it("不正な値は400で、tax_flag のエラーを返す", async () => {
    const res = await send("POST", "/api/transactions", { transactions: [{ amount: 800, tax_flag: "bogus" }] });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, errors: [{ index: 0, field: "tax_flag" }] });
  });

  it("ホームの最近の取引にも含まれる", async () => {
    await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 300, merchant: "B店", tax_flag: "self_medication" }] });
    const home = await json(await call("/api/home"));
    expect(home.recent[0].tax_flag).toBe("self_medication");
  });

  it("従来の CSRF・415 の仕組みは変わらない", async () => {
    const body = { transactions: [{ amount: 100, tax_flag: "medical" }] };
    const cross = await send("POST", "/api/transactions", body, { "content-type": "application/json", origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    const wrongType = await send("POST", "/api/transactions", body, { "content-type": "text/plain" });
    expect(wrongType.status).toBe(415);
  });
});
