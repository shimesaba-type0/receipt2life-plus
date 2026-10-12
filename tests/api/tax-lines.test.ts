import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { todayJst } from "../../src/core/dates";
import { testEnv } from "../helpers";

// 税率・税の内訳の API と GET /api/tax-summary。店名・金額はダミー
const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, local);
const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

async function addOne() {
  const res = await send("POST", "/api/transactions", {
    transactions: [
      {
        date: todayJst(),
        amount: 1640,
        merchant: "Aストア",
        items: [
          { name: "牛乳", amount: 540, tax_rate: 8, tax_label: "※" },
          { name: "洗剤", amount: 1100, tax_rate: 10 },
        ],
        tax_lines: [
          { rate: 10, taxable_amount: 1100, tax_amount: 100, amount_basis: "included" },
          { rate: 8, taxable_amount: 540, tax_amount: 40, amount_basis: "included", label: "※" },
        ],
      },
    ],
  });
  expect(res.status).toBe(200);
  return json(res);
}

describe("API の税率・税の内訳", () => {
  it("POST / GET / PATCH に tax_rate・tax_label・tax_lines が通る", async () => {
    const added = await addOne();
    const tx = added.registered[0];
    expect(added.tax_warnings).toEqual([]);
    expect(tx.tax_lines).toHaveLength(2);

    const got = await json(await call(`/api/transactions/${tx.id}`));
    expect(got.transaction.items[0]).toMatchObject({ tax_rate: 8, tax_label: "※" });
    expect(got.transaction.tax_lines.map((l: { rate: number }) => l.rate)).toEqual([10, 8]);

    const day = await json(await call(`/api/day/${todayJst()}`));
    expect(day.transactions[0].tax_lines).toHaveLength(2);

    const patched = await send("PATCH", `/api/transactions/${tx.id}`, { tax_lines: [{ rate: 10, tax_amount: 149 }] });
    expect(patched.status).toBe(200);
    expect((await json(patched)).transaction.tax_lines).toMatchObject([{ rate: 10, tax_amount: 149, taxable_amount: null, amount_basis: null }]);

    const bad = await send("PATCH", `/api/transactions/${tx.id}`, { tax_lines: [{ rate: 120 }] });
    expect(bad.status).toBe(400);
    expect((await json(bad)).errors[0].field).toContain("tax_lines");
  });

  it("旧形式の入力(税率・内訳なし)も通る", async () => {
    const res = await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 300, merchant: "Bマート" }] });
    expect(res.status).toBe(200);
    expect((await json(res)).registered[0].tax_lines).toEqual([]);
  });

  it("GET /api/tax-summary: 税率別・月別・カバレッジ。no-store。入力の誤りは400", async () => {
    await addOne();
    await send("POST", "/api/transactions", { transactions: [{ date: todayJst(), amount: 300, merchant: "Bマート" }] });

    const res = await call("/api/tax-summary");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, group_by: "rate", totals: { tax_total: 140, receipt_count: 1 }, coverage: { without_tax_lines: { count: 1, total: 300 } } });
    expect(body.rows.map((r: { rate: number }) => r.rate)).toEqual([10, 8]);

    const month = await json(await call(`/api/tax-summary?group_by=month&from=${todayJst().slice(0, 7)}-01&to=`));
    expect(month.rows[0].month).toBe(todayJst().slice(0, 7));

    expect((await call("/api/tax-summary?group_by=weekly")).status).toBe(400);
    expect((await call("/api/tax-summary?from=2026-10-02&to=2026-10-01")).status).toBe(400);
    expect((await call("/api/tax-summary?from=2026-13-01")).status).toBe(400);
  });

  it("書き込みは既存のガード(別オリジンは403、JSON以外は415)に乗る", async () => {
    const { registered } = await addOne();
    const id = registered[0].id as string;
    expect((await send("PATCH", `/api/transactions/${id}`, { tax_lines: [] }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(`/api/transactions/${id}`, { method: "PATCH", body: JSON.stringify({ tax_lines: [] }), headers: { "content-type": "text/plain" } })).status).toBe(415);
  });
});
