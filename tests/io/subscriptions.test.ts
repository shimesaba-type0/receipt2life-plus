import { describe, expect, it } from "vitest";
import { addSubscription, updateSubscription } from "../../src/core/subscriptions";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");

async function exportRecords(): Promise<Record<string, unknown>[]> {
  const text = await new Response(exportJsonl(db())).text();
  return text === "" ? [] : text.trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}
async function doImport(text: string): Promise<Extract<ImportResponse, { ok: true }>> {
  const res = await importRecords(db(), text, { now: NOW });
  if (!res.ok) throw new Error(`import failed: ${res.error}`);
  return res;
}
const count = async () => (await db().prepare("SELECT COUNT(*) AS n FROM subscriptions").first<{ n: number }>())!.n;

describe("サブスクのバックアップ", () => {
  it("type=subscription の行が最後に出る。active は true / false", async () => {
    const a = await addSubscription(db(), { name: "ダミー動画", amount: 1000, period: "monthly" }, { now: NOW });
    if (!a.ok) throw new Error("add");
    await updateSubscription(db(), { id: a.subscription.id, amount: 1200 }, { now: NOW });
    const rows = await exportRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "subscription", name: "ダミー動画", amount: 1200, period: "monthly", previous_amount: 1000, active: true, kind: "subscription" });
  });

  it("往復で同じ内容に戻り、2回戻しても増えない(skipped_exists)", async () => {
    const a = await addSubscription(db(), { name: "ダミー保険", kind: "insurance", amount: 24000, period: "yearly", billing_month: 6, url: "https://example.test/p", note: "プラン", active: false }, { now: NOW });
    if (!a.ok) throw new Error("add");
    const rows = await exportRecords();
    await db().prepare("DELETE FROM subscriptions").run();
    const text = jsonl(...rows);
    const first = await doImport(text);
    expect(first.results[0]).toMatchObject({ status: "ok", type: "subscription" });
    expect(await exportRecords()).toEqual(rows);
    const second = await doImport(text);
    expect(second.results[0]).toMatchObject({ status: "skipped_exists" });
    expect(await count()).toBe(1);
  });

  it("不正な行はその行だけエラー(周期・月払いの更新月・URL・未知の項目)", async () => {
    const res = await doImport(
      jsonl(
        { type: "subscription", name: "A", amount: 100, period: "weekly" },
        { type: "subscription", name: "B", amount: 100, period: "monthly", billing_month: 3 },
        { type: "subscription", name: "C", amount: 100, period: "monthly", url: "http://example.test/" },
        { type: "subscription", name: "D", amount: 100, period: "monthly", extra: 1 },
        { type: "subscription", name: "OK", amount: 100, period: "monthly" },
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "error", "error", "ok"]);
    expect(await count()).toBe(1);
  });

  it("外貨のサブスクも往復で同じ内容に戻る(円の目安・レート・直前の外貨の金額)", async () => {
    const a = await addSubscription(db(), { name: "ダミーAI", currency: "USD", foreign_amount: 20, exchange_rate: 150.5, period: "monthly", billing_day: 23 }, { now: NOW });
    if (!a.ok) throw new Error("add");
    await updateSubscription(db(), { id: a.subscription.id, foreign_amount: 22.5 }, { now: NOW });
    await addSubscription(db(), { name: "円", amount: 500, period: "monthly" }, { now: NOW });
    const before = await exportRecords();
    expect(before.find((r) => r.name === "ダミーAI")).toMatchObject({ currency: "USD", foreign_amount: 22.5, exchange_rate: 150.5, previous_foreign_amount: 20, amount: 3386 });
    await db().prepare("DELETE FROM subscriptions").run();
    const restored = await doImport(before.map((r) => JSON.stringify(r)).join("\n"));
    expect(restored.summary).toMatchObject({ ok: 2, errors: 0 });
    expect(await exportRecords()).toEqual(before);
  });

  it("取り込み: 外貨の項目が足りない・円なのに外貨の項目がある行は、その行だけエラー", async () => {
    const res = await doImport(
      jsonl(
        { type: "subscription", name: "A", currency: "USD", amount: 3000, period: "monthly" },
        { type: "subscription", name: "B", currency: "JPY", amount: 100, foreign_amount: 1, period: "monthly" },
        { type: "subscription", name: "C", currency: "USD", foreign_amount: 10, exchange_rate: 150, period: "monthly" },
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "ok"]);
    expect(await db().prepare("SELECT amount FROM subscriptions WHERE name = 'C'").first()).toEqual({ amount: 1500 });
  });
});

