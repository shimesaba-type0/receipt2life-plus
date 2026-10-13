import { describe, expect, it } from "vitest";
import { addSubscription, deleteSubscription, listSubscriptions, nextBillingMonth, updateSubscription } from "../../src/core/subscriptions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const add = (input: unknown) => addSubscription(db(), input, { now: NOW });

async function addOk(input: unknown) {
  const res = await add(input);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.subscription;
}

describe("addSubscription", () => {
  it("月払いを登録する。月あたり・年あたりに直した金額と、確認した日(今日)が入る", async () => {
    const s = await addOk({ name: "ダミー動画", amount: 1200, period: "monthly" });
    expect(s).toMatchObject({ name: "ダミー動画", kind: "subscription", amount: 1200, period: "monthly", monthly_equivalent: 1200, yearly_equivalent: 14400, active: true, price_checked_on: "2026-10-11", previous_amount: null, next_billing_month: null });
  });

  it("年払いは、月あたり=年額÷12の四捨五入。更新月から次の支払い月が出る", async () => {
    const s = await addOk({ name: "ダミー保険", kind: "insurance", amount: 25000, period: "yearly", billing_month: 3 });
    expect(s).toMatchObject({ kind: "insurance", monthly_equivalent: 2083, yearly_equivalent: 25000, billing_month: 3, next_billing_month: "2027-03" });
  });

  it("月払いに billing_month は付けられない。url は https のみ(正規化)。不正はエラー", async () => {
    expect((await add({ name: "A", amount: 100, period: "monthly", billing_month: 3 })).ok).toBe(false);
    expect((await add({ name: "A", amount: 100, period: "monthly", url: "http://example.test/" })).ok).toBe(false);
    expect((await add({ name: "A", amount: 100, period: "monthly", url: "https://user:pw@example.test/" })).ok).toBe(false);
    const s = await addOk({ name: "B", amount: 100, period: "monthly", url: "https://example.test/price#top" });
    expect(s.url).toBe("https://example.test/price");
    expect((await add({ name: "", amount: 100, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "C", amount: -1, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "C", amount: 1.5, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "C", amount: 100, period: "weekly" })).ok).toBe(false);
    expect((await add({ name: "C", amount: 100, period: "monthly", x: 1 })).ok).toBe(false);
  });
});

describe("nextBillingMonth", () => {
  it("今月を含み、過ぎていれば来年", () => {
    expect(nextBillingMonth("yearly", 10, "2026-10-11")).toBe("2026-10");
    expect(nextBillingMonth("yearly", 9, "2026-10-11")).toBe("2027-09");
    expect(nextBillingMonth("yearly", null, "2026-10-11")).toBeNull();
    expect(nextBillingMonth("monthly", 3, "2026-10-11")).toBeNull();
  });
});

describe("updateSubscription", () => {
  it("金額を変えると、直前の金額・変えた日・確認した日が記録される", async () => {
    const s = await addOk({ name: "ダミー動画", amount: 1000, period: "monthly" });
    const res = await updateSubscription(db(), { id: s.id, amount: 1300 }, { now: new Date("2026-10-20T03:00:00Z") });
    if (!res.ok) throw new Error("update");
    expect(res.subscription).toMatchObject({ amount: 1300, previous_amount: 1000, amount_changed_on: "2026-10-20", price_checked_on: "2026-10-20" });
    expect(res.message).toContain("1,000円 から 1,300円");
  });

  it("同じ金額なら、直前の金額は変わらず、確認した日だけ更新される", async () => {
    const s = await addOk({ name: "ダミー動画", amount: 1000, period: "monthly" });
    const res = await updateSubscription(db(), { id: s.id, amount: 1000 }, { now: new Date("2026-10-20T03:00:00Z") });
    if (!res.ok) throw new Error("update");
    expect(res.subscription).toMatchObject({ previous_amount: null, amount_changed_on: null, price_checked_on: "2026-10-20" });
  });

  it("price_checked: true で、確認した日だけ今日になる。解約は active: false", async () => {
    const s = await addOk({ name: "ダミー動画", amount: 1000, period: "monthly" });
    const checked = await updateSubscription(db(), { id: s.id, price_checked: true }, { now: new Date("2026-11-01T03:00:00Z") });
    if (!checked.ok) throw new Error("update");
    expect(checked.subscription.price_checked_on).toBe("2026-11-01");
    const off = await updateSubscription(db(), { id: s.id, active: false });
    if (!off.ok) throw new Error("update");
    expect(off.subscription.active).toBe(false);
  });

  it("null で billing_month / url / note を消せる。月払いに変えると更新月は消える", async () => {
    const s = await addOk({ name: "ダミー保険", amount: 12000, period: "yearly", billing_month: 5, note: "プラン", url: "https://example.test/" });
    const cleared = await updateSubscription(db(), { id: s.id, note: null, url: null });
    if (!cleared.ok) throw new Error("update");
    expect(cleared.subscription).toMatchObject({ note: null, url: null, billing_month: 5 });
    const monthly = await updateSubscription(db(), { id: s.id, period: "monthly", amount: 1000 });
    if (!monthly.ok) throw new Error("update");
    expect(monthly.subscription).toMatchObject({ period: "monthly", billing_month: null });
  });

  it("存在しない id・空の更新・不正な値はエラー", async () => {
    const s = await addOk({ name: "A", amount: 100, period: "monthly" });
    const missing = await updateSubscription(db(), { id: "nope", amount: 1 });
    expect(missing).toMatchObject({ ok: false, errors: [{ field: "id", message: expect.stringContaining("というサブスクはありません") }] });
    expect((await updateSubscription(db(), { id: s.id })).ok).toBe(false);
    expect((await updateSubscription(db(), { id: s.id, amount: -5 })).ok).toBe(false);
    expect((await updateSubscription(db(), { id: s.id, billing_month: 13 })).ok).toBe(false);
  });
});

describe("listSubscriptions / deleteSubscription", () => {
  it("契約中の合計(月あたり・年あたり)を返す。解約済みは合計に入れない", async () => {
    await addOk({ name: "月払い", amount: 1000, period: "monthly" });
    await addOk({ name: "年払い", amount: 12000, period: "yearly", billing_month: 2 });
    const off = await addOk({ name: "解約済み", amount: 5000, period: "monthly" });
    await updateSubscription(db(), { id: off.id, active: false });
    const res = await listSubscriptions(db(), {}, { now: NOW });
    if (!res.ok) throw new Error("list");
    expect(res.count).toBe(3);
    expect(res.totals).toEqual({ monthly: 2000, yearly: 24000, count: 2 });
    // 契約中が先
    expect(res.subscriptions.map((s) => s.name).at(-1)).toBe("解約済み");
    const activeOnly = await listSubscriptions(db(), { active: true });
    if (activeOnly.ok) expect(activeOnly.count).toBe(2);
    const offOnly = await listSubscriptions(db(), { active: false });
    if (offOnly.ok) expect(offOnly.subscriptions.map((s) => s.name)).toEqual(["解約済み"]);
    const ins = await listSubscriptions(db(), { kind: "insurance" });
    if (ins.ok) expect(ins.count).toBe(0);
  });

  it("削除する。存在しない id はエラー", async () => {
    const s = await addOk({ name: "A", amount: 100, period: "monthly" });
    const del = await deleteSubscription(db(), { id: s.id });
    expect(del.ok).toBe(true);
    expect((await deleteSubscription(db(), { id: s.id })).ok).toBe(false);
    const res = await listSubscriptions(db(), {});
    if (res.ok) expect(res.count).toBe(0);
  });
});

describe("外貨払い(ドル・ユーロなど)", () => {
  it("USD の月払いを登録する。円は 外貨×レート の四捨五入(目安)で、月あたり・年あたりもその円", async () => {
    const s = await addOk({ name: "ダミーAI", currency: "USD", foreign_amount: 20, exchange_rate: 150.5, period: "monthly", billing_day: 23 });
    expect(s).toMatchObject({ currency: "USD", foreign_amount: 20, exchange_rate: 150.5, amount: 3010, amount_is_estimate: true, monthly_equivalent: 3010, yearly_equivalent: 36120, billing_day: 23, previous_foreign_amount: null });
  });

  it("セントつきの金額・年払い・EUR", async () => {
    const s = await addOk({ name: "ダミー年額", currency: "EUR", foreign_amount: 99.99, exchange_rate: 160, period: "yearly", billing_month: 5 });
    expect(s).toMatchObject({ currency: "EUR", foreign_amount: 99.99, amount: 15998, monthly_equivalent: 1333, next_billing_month: "2027-05" });
  });

  it("円は従来どおり(currency 省略で JPY)。円の行に外貨の項目は付けられず、外貨の行に amount は付けられない", async () => {
    const jpy = await addOk({ name: "円", amount: 500, period: "monthly" });
    expect(jpy).toMatchObject({ currency: "JPY", foreign_amount: null, exchange_rate: null, amount_is_estimate: false });
    expect((await add({ name: "A", amount: 500, foreign_amount: 5, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", amount: 500, exchange_rate: 150, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "USD", amount: 3000, foreign_amount: 20, exchange_rate: 150, period: "monthly" })).ok).toBe(false);
  });

  it("外貨は foreign_amount と exchange_rate が必須。桁数・範囲・通貨の不正はエラー", async () => {
    expect((await add({ name: "A", currency: "USD", exchange_rate: 150, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "USD", foreign_amount: 20, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "USD", foreign_amount: 20.123, exchange_rate: 150, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "USD", foreign_amount: 20, exchange_rate: 150.12345, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "USD", foreign_amount: 0, exchange_rate: 150, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "USD", foreign_amount: 20, exchange_rate: -1, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "XXX", foreign_amount: 20, exchange_rate: 150, period: "monthly" })).ok).toBe(false);
    expect((await add({ name: "A", currency: "USD", foreign_amount: 1_000_000, exchange_rate: 150, period: "monthly" })).ok).toBe(false);
  });

  it("外貨の金額を変えると、直前の外貨の金額・変えた日が残る。レートだけ変えても円の目安が計算し直されるだけ", async () => {
    const s = await addOk({ name: "ダミーAI", currency: "USD", foreign_amount: 20, exchange_rate: 150, period: "monthly" });
    const up = await updateSubscription(db(), { id: s.id, foreign_amount: 22.5 }, { now: NOW });
    expect(up.ok && up.subscription).toMatchObject({ foreign_amount: 22.5, previous_foreign_amount: 20, amount: 3375, amount_changed_on: "2026-10-11", previous_amount: null });
    expect(up.ok && up.message).toContain("USD 20.00 から USD 22.50");
    const rate = await updateSubscription(db(), { id: s.id, exchange_rate: 140 }, { now: NOW });
    expect(rate.ok && rate.subscription).toMatchObject({ foreign_amount: 22.5, exchange_rate: 140, amount: 3150, previous_foreign_amount: 20 });
    expect(rate.ok && rate.message).toContain("換算レートを 150円 から 140円");
  });

  it("更新: 外貨の行に amount は渡せない。円→外貨は両方が必要。外貨→円に戻せる", async () => {
    const s = await addOk({ name: "ダミーAI", currency: "USD", foreign_amount: 20, exchange_rate: 150, period: "monthly" });
    expect((await updateSubscription(db(), { id: s.id, amount: 3000 }, { now: NOW })).ok).toBe(false);
    const jpy = await addOk({ name: "円", amount: 1000, period: "monthly" });
    expect((await updateSubscription(db(), { id: jpy.id, currency: "USD" }, { now: NOW })).ok).toBe(false);
    expect((await updateSubscription(db(), { id: jpy.id, currency: "USD", foreign_amount: 7 }, { now: NOW })).ok).toBe(false);
    const toUsd = await updateSubscription(db(), { id: jpy.id, currency: "USD", foreign_amount: 7, exchange_rate: 150 }, { now: NOW });
    expect(toUsd.ok && toUsd.subscription).toMatchObject({ currency: "USD", amount: 1050, previous_amount: null, previous_foreign_amount: null });
    const back = await updateSubscription(db(), { id: s.id, currency: "JPY" }, { now: NOW });
    expect(back.ok && back.subscription).toMatchObject({ currency: "JPY", foreign_amount: null, exchange_rate: null, amount: 3000, amount_is_estimate: false });
    expect((await updateSubscription(db(), { id: s.id, currency: "JPY", foreign_amount: 5 }, { now: NOW })).ok).toBe(false);
  });

  it("一覧の合計には、外貨は目安の円で入る", async () => {
    await addOk({ name: "円", amount: 1000, period: "monthly" });
    await addOk({ name: "ドル", currency: "USD", foreign_amount: 10, exchange_rate: 150, period: "monthly" });
    const list = await listSubscriptions(db(), {}, { now: NOW });
    expect(list.ok && list.totals).toEqual({ monthly: 2500, yearly: 30000, count: 2 });
  });
});

