import { describe, expect, it } from "vitest";
import type { SubscriptionView } from "../../src/api/contract";
import {
  amountLabel,
  buildStack,
  emptySubscriptionForm,
  groupSubscriptions,
  monthLabel,
  nextPaymentLabel,
  priceChangeLabel,
  priceCheckedLabel,
  safeHttpsUrl,
  shortDate,
  validateSubscriptionForm,
} from "../../ui/src/pages/subscriptionsLogic";

const sub = (over: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: "s1",
  name: "ダミー配信",
  kind: "subscription",
  amount: 1000,
  period: "monthly",
  monthly_equivalent: 1000,
  yearly_equivalent: 12000,
  billing_month: null,
  billing_day: null,
  next_billing_month: null,
  previous_amount: null,
  amount_changed_on: null,
  price_checked_on: null,
  url: null,
  note: null,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

describe("buildStack", () => {
  it("合計0・0件は空", () => {
    expect(buildStack([])).toEqual([]);
    expect(buildStack([sub({ monthly_equivalent: 0 })])).toEqual([]);
  });
  it("1件は100%・幅100", () => {
    const [seg] = buildStack([sub()]);
    expect(seg?.percentText).toBe("100%");
    expect(seg?.width).toBe(100);
  });
  it("金額の大きい順。ゼロ円と解約済みは出さない", () => {
    const r = buildStack([
      sub({ id: "a", name: "A", monthly_equivalent: 300 }),
      sub({ id: "b", name: "B", monthly_equivalent: 700 }),
      sub({ id: "z", name: "Z", monthly_equivalent: 0 }),
      sub({ id: "c", name: "C", monthly_equivalent: 900, active: false }),
    ]);
    expect(r.map((s) => s.id)).toEqual(["b", "a"]);
    expect(r.map((s) => s.percentText)).toEqual(["70%", "30%"]);
  });
  it("端数は四捨五入で小数1桁(最大の項目に寄せない)", () => {
    const r = buildStack([1, 2, 3].map((n) => sub({ id: `i${n}`, name: `n${n}`, monthly_equivalent: 1 })));
    expect(r.map((s) => s.percentText)).toEqual(["33.3%", "33.3%", "33.3%"]);
    const r2 = buildStack([sub({ id: "a", monthly_equivalent: 2 }), sub({ id: "b", name: "b", monthly_equivalent: 1 })]);
    expect(r2.map((s) => s.percentText)).toEqual(["66.7%", "33.3%"]);
  });
  it("色は項目ごとに違う系統色", () => {
    const r = buildStack([sub({ id: "a", monthly_equivalent: 2 }), sub({ id: "b", name: "b", monthly_equivalent: 1 })]);
    expect(r[0]?.color).toBe("#1F5C4B");
    expect(r[1]?.color).toBe("#5E9C86");
  });
});

describe("表示文字列", () => {
  it("金額と周期", () => {
    expect(amountLabel(sub({ amount: 1280, monthly_equivalent: 1280 }))).toBe("¥1,280/月");
    expect(amountLabel(sub({ amount: 12000, period: "yearly", monthly_equivalent: 1000 }))).toBe("¥12,000/年(月あたり ¥1,000)");
  });
  it("次の支払い", () => {
    expect(nextPaymentLabel("2027-03")).toBe("次の支払い: 2027年3月");
    expect(nextPaymentLabel(null)).toBeNull();
  });
  it("値上がり/値下がり", () => {
    expect(priceChangeLabel({ amount: 1300, previous_amount: 1000, amount_changed_on: "2026-10-12" })).toBe("値上がり +¥300(10/12)");
    expect(priceChangeLabel({ amount: 800, previous_amount: 1000, amount_changed_on: null })).toBe("値下がり −¥200");
    expect(priceChangeLabel({ amount: 1000, previous_amount: 1000, amount_changed_on: "2026-10-12" })).toBeNull();
    expect(priceChangeLabel({ amount: 1000, previous_amount: null, amount_changed_on: null })).toBeNull();
  });
  it("金額の確認・日付・月", () => {
    expect(priceCheckedLabel("2026-10-12")).toBe("金額の確認: 10/12");
    expect(priceCheckedLabel(null)).toBeNull();
    expect(shortDate("2026-01-05")).toBe("1/5");
    expect(monthLabel(3)).toBe("3月");
  });
  it("リンクは https だけ", () => {
    expect(safeHttpsUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });
});

describe("groupSubscriptions", () => {
  it("契約中を月払い/年払いに分け、解約済みは別", () => {
    const g = groupSubscriptions([
      sub({ id: "m", name: "B" }),
      sub({ id: "m2", name: "A" }),
      sub({ id: "y", period: "yearly" }),
      sub({ id: "c", active: false }),
    ]);
    expect(g.monthly.map((s) => s.id)).toEqual(["m2", "m"]);
    expect(g.yearly.map((s) => s.id)).toEqual(["y"]);
    expect(g.cancelled.map((s) => s.id)).toEqual(["c"]);
  });
});

describe("validateSubscriptionForm", () => {
  const ok = { ...emptySubscriptionForm(), name: " ダミー ", amount: "1,280" };
  it("正常(前後の空白を除き、金額は整数にする)", () => {
    const r = validateSubscriptionForm(ok);
    expect(r).toEqual({
      ok: true,
      value: { name: "ダミー", kind: "subscription", amount: 1280, period: "monthly", billing_month: null, billing_day: null, url: null, note: null, active: true },
    });
  });
  it("名前必須", () => {
    expect(validateSubscriptionForm({ ...ok, name: "  " }).ok).toBe(false);
  });
  it("金額は0以上の整数(0は可)", () => {
    expect(validateSubscriptionForm({ ...ok, amount: "0" }).ok).toBe(true);
    for (const amount of ["", "-1", "1.5", "abc", "99999999"]) expect(validateSubscriptionForm({ ...ok, amount }).ok, amount).toBe(false);
  });
  it("更新月は年払いだけ(1〜12)", () => {
    expect(validateSubscriptionForm({ ...ok, billingMonth: "3" }).ok).toBe(false);
    const y = { ...ok, period: "yearly" as const };
    const r = validateSubscriptionForm({ ...y, billingMonth: "3" });
    expect(r.ok && r.value.billing_month).toBe(3);
    expect(validateSubscriptionForm({ ...y, billingMonth: "13" }).ok).toBe(false);
  });
  it("支払日は1〜31", () => {
    expect(validateSubscriptionForm({ ...ok, billingDay: "31" }).ok).toBe(true);
    expect(validateSubscriptionForm({ ...ok, billingDay: "0" }).ok).toBe(false);
    expect(validateSubscriptionForm({ ...ok, billingDay: "32" }).ok).toBe(false);
  });
  it("URLは https のみ(空は可)", () => {
    expect(validateSubscriptionForm({ ...ok, url: "https://example.com/x" }).ok).toBe(true);
    for (const url of ["http://example.com", "javascript:alert(1)", "example.com", "https://a b.example"]) expect(validateSubscriptionForm({ ...ok, url }).ok, url).toBe(false);
  });
  it("メモは200文字まで", () => {
    expect(validateSubscriptionForm({ ...ok, note: "あ".repeat(201) }).ok).toBe(false);
  });
});
