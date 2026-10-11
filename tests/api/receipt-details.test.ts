import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

// API とレシートの情報。電話・住所・番号はダミー
const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
const send = (method: string, path: string, body?: unknown) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("API のレシートの情報", () => {
  it("POST で登録(正規化)し、GET /api/transactions/:id・day・home に含まれ、PATCH で変更・null で空にできる", async () => {
    const date = todayJst();
    const add = await send("POST", "/api/transactions", {
      transactions: [
        {
          date,
          amount: 2400,
          merchant: "Aタクシー",
          paid_time: "14:32",
          merchant_phone: "０３−００００−００００",
          merchant_address: "東京都〇〇区〇〇1-2-3",
          invoice_number: "t 0000-0000-00000",
          clerk_name: "山田",
          receipt_no: "R-100",
        },
      ],
    });
    expect(add.status).toBe(200);
    const added = await json(add);
    const id = added.registered[0].id as string;
    const expected = {
      paid_time: "14:32",
      merchant_phone: "03-0000-0000",
      merchant_address: "東京都〇〇区〇〇1-2-3",
      invoice_number: "T0000000000000",
      clerk_name: "山田",
      receipt_no: "R-100",
    };
    expect(added.registered[0]).toMatchObject(expected);

    expect((await json(await call(`/api/transactions/${id}`))).transaction).toMatchObject(expected);
    expect((await json(await call(`/api/day/${date}`))).transactions[0]).toMatchObject(expected);
    expect((await json(await call("/api/home"))).recent[0]).toMatchObject(expected);

    const patch = await json(await send("PATCH", `/api/transactions/${id}`, { merchant_phone: "045-111-2222", paid_time: null }));
    expect(patch).toMatchObject({ ok: true, transaction: { merchant_phone: "045-111-2222", paid_time: null, clerk_name: "山田" } });
  });

  it("既存の形の登録(6項目なし)は今までどおり通り、6項目は null で返る", async () => {
    const res = await json(await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 300, merchant: "B店" }] }));
    expect(res.registered[0]).toMatchObject({ paid_time: null, merchant_phone: null, merchant_address: null, invoice_number: null, clerk_name: null, receipt_no: null });
  });

  it("不正な値は400で、項目名つきの日本語エラー", async () => {
    const res = await send("POST", "/api/transactions", { transactions: [{ amount: 800, invoice_number: "T123", paid_time: "25:61" }] });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.ok).toBe(false);
    expect(body.errors.map((e: { field: string }) => e.field).sort()).toEqual(["invoice_number", "paid_time"]);
    expect(body.errors.find((e: { field: string }) => e.field === "invoice_number").message).toContain("T と数字13桁で入力してください");

    const add = await json(await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 100, merchant: "C店" }] }));
    const bad = await send("PATCH", `/api/transactions/${add.registered[0].id}`, { invoice_number: "T123" });
    expect(bad.status).toBe(400);
    expect((await json(bad)).errors[0].field).toBe("invoice_number");
  });

  it("日の一覧は、決済時刻の昇順(時刻なしは末尾)", async () => {
    const date = todayJst();
    await send("POST", "/api/transactions", { transactions: [{ date, amount: 100, merchant: "夕方", paid_time: "18:00" }] });
    await send("POST", "/api/transactions", { transactions: [{ date, amount: 200, merchant: "時刻なし" }] });
    await send("POST", "/api/transactions", { transactions: [{ date, amount: 300, merchant: "朝", paid_time: "07:30" }] });
    const day = await json(await call(`/api/day/${date}`));
    expect(day.transactions.map((t: { merchant: string }) => t.merchant)).toEqual(["朝", "夕方", "時刻なし"]);
  });
});
