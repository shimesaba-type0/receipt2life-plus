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
