// サブスク・固定費画面の純粋な部分(DOMに触れない。テストする)
// 上限と規則はサーバー(src/core/subscriptions.ts)と同じ
import type { SubscriptionKind, SubscriptionPeriod, SubscriptionView } from "../../../src/api/contract";
import { formatYen } from "../format";
import { formatPercent, groupColor, percentOf } from "./homeLogic";

export const MAX_SUBSCRIPTION_AMOUNT = 10_000_000;
export const MAX_SUBSCRIPTION_NAME = 100;
export const MAX_SUBSCRIPTION_NOTE = 200;

export const KIND_LABELS: Record<SubscriptionKind, string> = { subscription: "サブスク", insurance: "保険", other: "その他の固定費" };
export const KIND_OPTIONS: SubscriptionKind[] = ["subscription", "insurance", "other"];
export const PERIOD_LABELS: Record<SubscriptionPeriod, string> = { monthly: "月払い", yearly: "年払い" };

// ---- 表示文字列 ----

// "2026-10-12" → "10/12"。形式が違えばそのまま返す
export function shortDate(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}/${Number(m[2])}` : date;
}

// 1..12 → "3月"
export const monthLabel = (month: number): string => `${month}月`;

/** 金額と周期。月払い「¥1,280/月」、年払い「¥12,000/年(月あたり ¥1,000)」 */
export function amountLabel(s: Pick<SubscriptionView, "amount" | "period" | "monthly_equivalent">): string {
  if (s.period === "monthly") return `${formatYen(s.amount)}/月`;
  return `${formatYen(s.amount)}/年(月あたり ${formatYen(s.monthly_equivalent)})`;
}

/** 年払いの次の支払い。"2027-03" → "次の支払い: 2027年3月"。無ければ null */
export function nextPaymentLabel(next: string | null): string | null {
  const m = next ? /^(\d{4})-(\d{2})$/.exec(next) : null;
  return m ? `次の支払い: ${m[1]}年${Number(m[2])}月` : null;
}

/** 金額の変化。「値上がり +¥300(10/12)」「値下がり −¥200」。変わっていなければ null */
export function priceChangeLabel(s: Pick<SubscriptionView, "amount" | "previous_amount" | "amount_changed_on">): string | null {
  if (s.previous_amount === null) return null;
  const diff = s.amount - s.previous_amount;
  if (diff === 0) return null;
  const when = s.amount_changed_on ? `(${shortDate(s.amount_changed_on)})` : "";
  return diff > 0 ? `値上がり +${formatYen(diff)}${when}` : `値下がり −${formatYen(-diff)}${when}`;
}

/** 金額を最後に確認した日。「金額の確認: 10/12」。未確認は null */
export const priceCheckedLabel = (date: string | null): string | null => (date ? `金額の確認: ${shortDate(date)}` : null);

/** 支払日つきの補足(「毎月5日」など)。月払いは毎月、年払いは更新月があれば「3月5日」 */
export function billingDayLabel(s: Pick<SubscriptionView, "period" | "billing_month" | "billing_day">): string | null {
  if (s.billing_day === null) return null;
  if (s.period === "yearly" && s.billing_month !== null) return `支払日: ${s.billing_month}月${s.billing_day}日`;
  return s.period === "monthly" ? `支払日: 毎月${s.billing_day}日` : `支払日: ${s.billing_day}日`;
}

// ---- 積み上げの横棒 ----

export interface StackSegment {
  id: string;
  name: string;
  monthly: number;
  /** 割合(%)。四捨五入で小数1桁。端数は寄せない(合計がちょうど100にならないことがある) */
  percent: number;
  percentText: string;
  /** 横棒の幅(%)。合計が100になる */
  width: number;
  color: string;
}

/** 契約中の各項目の月あたりを、金額の大きい順に並べる。0円と解約済みは出さない。合計0・0件は空 */
export function buildStack(items: SubscriptionView[]): StackSegment[] {
  const live = items
    .filter((s) => s.active && s.monthly_equivalent > 0)
    .sort((a, b) => b.monthly_equivalent - a.monthly_equivalent || a.name.localeCompare(b.name, "ja"));
  const sum = live.reduce((acc, s) => acc + s.monthly_equivalent, 0);
  if (sum <= 0) return [];
  return live.map((s, i) => {
    const percent = percentOf(s.monthly_equivalent, sum);
    return { id: s.id, name: s.name, monthly: s.monthly_equivalent, percent, percentText: formatPercent(percent), width: (s.monthly_equivalent / sum) * 100, color: groupColor(i) };
  });
}

// ---- 一覧の分け方 ----

export interface SubscriptionGroups {
  monthly: SubscriptionView[];
  yearly: SubscriptionView[];
  cancelled: SubscriptionView[];
}

const byName = (a: SubscriptionView, b: SubscriptionView) => a.name.localeCompare(b.name, "ja");

/** 契約中を月払い/年払いに分け、解約済みは別にする(それぞれ名前順) */
export function groupSubscriptions(items: SubscriptionView[]): SubscriptionGroups {
  return {
    monthly: items.filter((s) => s.active && s.period === "monthly").sort(byName),
    yearly: items.filter((s) => s.active && s.period === "yearly").sort(byName),
    cancelled: items.filter((s) => !s.active).sort(byName),
  };
}

// ---- フォーム ----

export interface SubscriptionFormInput {
  name: string;
  kind: SubscriptionKind;
  amount: string;
  period: SubscriptionPeriod;
  billingMonth: string;
  billingDay: string;
  url: string;
  note: string;
  active: boolean;
}

export interface SubscriptionFormValue {
  name: string;
  kind: SubscriptionKind;
  amount: number;
  period: SubscriptionPeriod;
  billing_month: number | null;
  billing_day: number | null;
  url: string | null;
  note: string | null;
  active: boolean;
}

export type SubscriptionFormCheck = { ok: true; value: SubscriptionFormValue } | { ok: false; error: string };

export const emptySubscriptionForm = (): SubscriptionFormInput => ({ name: "", kind: "subscription", amount: "", period: "monthly", billingMonth: "", billingDay: "", url: "", note: "", active: true });

export const formFromSubscription = (s: SubscriptionView): SubscriptionFormInput => ({
  name: s.name,
  kind: s.kind,
  amount: String(s.amount),
  period: s.period,
  billingMonth: s.billing_month === null ? "" : String(s.billing_month),
  billingDay: s.billing_day === null ? "" : String(s.billing_day),
  url: s.url ?? "",
  note: s.note ?? "",
  active: s.active,
});

// 全角数字・カンマ・空白をそろえた半角の数字文字列
const digits = (raw: string): string => raw.normalize("NFKC").replace(/[,\s]/g, "");

function isHttpsUrl(raw: string): boolean {
  if (raw.length > 2048 || /[^\x21-\x7e]/.test(raw)) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.username === "" && u.password === "" && u.port === "" && u.hostname !== "";
  } catch {
    return false;
  }
}

/** 入力の検査。名前必須、金額は0以上の整数、年払い以外は更新月なし、URLは https、支払日は1〜31 */
export function validateSubscriptionForm(f: SubscriptionFormInput): SubscriptionFormCheck {
  const name = f.name.trim();
  if (name === "") return { ok: false, error: "名前を入れてください" };
  if (name.length > MAX_SUBSCRIPTION_NAME) return { ok: false, error: `名前は${MAX_SUBSCRIPTION_NAME}文字以内にしてください` };

  const amountText = digits(f.amount);
  if (amountText === "") return { ok: false, error: "金額を入れてください" };
  if (!/^\d+$/.test(amountText)) return { ok: false, error: "金額は0以上の整数(円)で入れてください" };
  const amount = Number(amountText);
  if (amount > MAX_SUBSCRIPTION_AMOUNT) return { ok: false, error: `金額は${MAX_SUBSCRIPTION_AMOUNT.toLocaleString("ja-JP")}円以下にしてください` };

  const monthText = digits(f.billingMonth);
  let billing_month: number | null = null;
  if (monthText !== "") {
    if (f.period !== "yearly") return { ok: false, error: "更新月は年払いのときだけ指定できます" };
    billing_month = Number(monthText);
    if (!/^\d+$/.test(monthText) || billing_month < 1 || billing_month > 12) return { ok: false, error: "更新月は1〜12月から選んでください" };
  }

  const dayText = digits(f.billingDay);
  let billing_day: number | null = null;
  if (dayText !== "") {
    billing_day = Number(dayText);
    if (!/^\d+$/.test(dayText) || billing_day < 1 || billing_day > 31) return { ok: false, error: "支払日は1〜31の整数で入れてください" };
  }

  const url = f.url.trim();
  if (url !== "" && !isHttpsUrl(url)) return { ok: false, error: "URLは https:// で始まるものだけ使えます" };

  const note = f.note.trim();
  if (note.length > MAX_SUBSCRIPTION_NOTE) return { ok: false, error: `メモは${MAX_SUBSCRIPTION_NOTE}文字以内にしてください` };

  return { ok: true, value: { name, kind: f.kind, amount, period: f.period, billing_month, billing_day, url: url === "" ? null : url, note: note === "" ? null : note, active: f.active } };
}

/** 一覧に出すリンクとして安全か(https だけ) */
export const safeHttpsUrl = (url: string | null): string | null => (url !== null && isHttpsUrl(url) ? url : null);
