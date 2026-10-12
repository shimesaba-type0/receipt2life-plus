import { z } from "zod";
import { parseHttpsUrl } from "./urls";
import { toFieldErrors, type FieldError } from "./schema";
import { todayJst } from "./dates";
import type { CoreOptions } from "./transactions";

// サブスク・保険などの固定費の登録(別枠)。支出の記録(transactions)とは独立で、ここに登録しても支出には数えない
// (実際に払った分は、レシート・明細として支出に記録する。ここは「いま何にいくら払っているか」の一覧)

export const SUBSCRIPTION_KINDS = ["subscription", "insurance", "other"] as const;
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];
export const SUBSCRIPTION_KIND_LABELS: Record<SubscriptionKind, string> = { subscription: "サブスク", insurance: "保険", other: "その他の固定費" };

export const SUBSCRIPTION_PERIODS = ["monthly", "yearly"] as const;
export type SubscriptionPeriod = (typeof SUBSCRIPTION_PERIODS)[number];
export const SUBSCRIPTION_PERIOD_LABELS: Record<SubscriptionPeriod, string> = { monthly: "月払い", yearly: "年払い" };

export const MAX_SUBSCRIPTION_AMOUNT = 10_000_000;
export const MAX_SUBSCRIPTION_NAME = 100;
export const MAX_SUBSCRIPTION_NOTE = 200;
export const MAX_SUBSCRIPTIONS = 500;

export interface SubscriptionView {
  id: string;
  name: string;
  kind: SubscriptionKind;
  // 1回の支払い額(円)。period が monthly なら月額、yearly なら年額
  amount: number;
  period: SubscriptionPeriod;
  // 月あたり・年あたりに直した金額(年払いは月あたり=年額÷12の四捨五入)
  monthly_equivalent: number;
  yearly_equivalent: number;
  billing_month: number | null;
  billing_day: number | null;
  // 年払いのとき、次に払う月(YYYY-MM。billing_month があるときだけ。今月を含む)
  next_billing_month: string | null;
  // 金額を変えたとき、直前の金額と変えた日(まだ変えていなければ null)
  previous_amount: number | null;
  amount_changed_on: string | null;
  // 金額を最後に確認した日
  price_checked_on: string | null;
  url: string | null;
  note: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface SubscriptionRow {
  id: string;
  name: string;
  kind: SubscriptionKind;
  amount: number;
  period: SubscriptionPeriod;
  billing_month: number | null;
  billing_day: number | null;
  previous_amount: number | null;
  amount_changed_on: string | null;
  price_checked_on: string | null;
  url: string | null;
  note: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, name, kind, amount, period, billing_month, billing_day, previous_amount, amount_changed_on, price_checked_on, url, note, active, created_at, updated_at";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export function monthlyEquivalent(amount: number, period: SubscriptionPeriod): number {
  return period === "monthly" ? amount : Math.round(amount / 12);
}
export function yearlyEquivalent(amount: number, period: SubscriptionPeriod): number {
  return period === "monthly" ? amount * 12 : amount;
}

// 年払いの次の支払い月(今月を含む)。billing_month が無ければ null
export function nextBillingMonth(period: SubscriptionPeriod, billingMonth: number | null, today: string): string | null {
  if (period !== "yearly" || billingMonth === null) return null;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const y = billingMonth >= month ? year : year + 1;
  return `${y}-${String(billingMonth).padStart(2, "0")}`;
}

export function toView(row: SubscriptionRow, today: string): SubscriptionView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    amount: row.amount,
    period: row.period,
    monthly_equivalent: monthlyEquivalent(row.amount, row.period),
    yearly_equivalent: yearlyEquivalent(row.amount, row.period),
    billing_month: row.billing_month,
    billing_day: row.billing_day,
    next_billing_month: nextBillingMonth(row.period, row.billing_month, today),
    previous_amount: row.previous_amount,
    amount_changed_on: row.amount_changed_on,
    price_checked_on: row.price_checked_on,
    url: row.url,
    note: row.note,
    active: row.active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---- 入力 ----

const nameField = z.string().trim().min(1, "name は必須です").max(MAX_SUBSCRIPTION_NAME, `name は${MAX_SUBSCRIPTION_NAME}文字以内にしてください`);
const amountField = z
  .number({ error: "amount は数値(円)で指定してください" })
  .int("amount は整数(円)で指定してください")
  .min(0, "amount は0以上にしてください")
  .max(MAX_SUBSCRIPTION_AMOUNT, `amount は${MAX_SUBSCRIPTION_AMOUNT.toLocaleString("ja-JP")}円以下にしてください`);
const kindField = z.enum(SUBSCRIPTION_KINDS, { error: `kind は ${SUBSCRIPTION_KINDS.join(" / ")} のいずれかで指定してください` });
const periodField = z.enum(SUBSCRIPTION_PERIODS, { error: `period は ${SUBSCRIPTION_PERIODS.join(" / ")} のいずれかで指定してください` });
const monthField = z.number().int().min(1, "billing_month は1〜12で指定してください").max(12, "billing_month は1〜12で指定してください");
const dayField = z.number().int().min(1, "billing_day は1〜31で指定してください").max(31, "billing_day は1〜31で指定してください");
const urlField = z.string().trim().min(1).max(2048);
const noteField = z.string().trim().max(MAX_SUBSCRIPTION_NOTE, `note は${MAX_SUBSCRIPTION_NOTE}文字以内にしてください`);

export const subscriptionFieldsSchema = z.strictObject({
  name: nameField.describe("名前(例: 動画配信サービス、自動車保険)。必須"),
  amount: amountField.describe("1回の支払い額(円・整数)。period が monthly なら月額、yearly なら年額。必須"),
  period: periodField.describe("monthly=月払い / yearly=年払い(年額を一括で払う)。必須"),
  kind: kindField.default("subscription").describe("subscription=サブスク(既定) / insurance=保険 / other=その他の固定費"),
  billing_month: monthField.optional().describe("支払う月(1〜12)。年払いの更新月。任意"),
  billing_day: dayField.optional().describe("支払う日(1〜31)。任意"),
  url: urlField.optional().describe("サービスの公式ページや料金ページのURL(https)。任意"),
  note: noteField.optional().describe(`メモ(${MAX_SUBSCRIPTION_NOTE}文字まで。プラン名など)。任意`),
  active: z.boolean().default(true).describe("true=契約中(既定)、false=解約済み(合計に入れない)"),
});

export const updateSubscriptionFieldsSchema = z.strictObject({
  id: z.string().min(1, "id は必須です").describe("更新するサブスクの id(list_subscriptions で分かる)。必須"),
  name: nameField.optional().describe("新しい名前"),
  amount: amountField.optional().describe("新しい金額(円)。変えると、直前の金額・変えた日・確認した日が自動で記録される"),
  period: periodField.optional().describe("新しい支払い周期"),
  kind: kindField.optional().describe("新しい種類"),
  billing_month: monthField.nullable().optional().describe("支払う月。null で消す"),
  billing_day: dayField.nullable().optional().describe("支払う日。null で消す"),
  url: urlField.nullable().optional().describe("URL(https)。null で消す"),
  note: noteField.nullable().optional().describe("メモ。null か空文字で消す"),
  active: z.boolean().optional().describe("false で解約済みにする(記録は残る)。true で契約中に戻す"),
  price_checked: z.boolean().optional().describe("true を渡すと、金額を確認した日を今日にする(金額が変わっていなかったとき)"),
});

export const deleteSubscriptionSchema = z.strictObject({ id: z.string().min(1, "id は必須です").describe("削除するサブスクの id。必須") });

export const listSubscriptionsFieldsSchema = z.strictObject({
  active: z.boolean().optional().describe("true=契約中だけ、false=解約済みだけ。省略は全部"),
  kind: kindField.optional().describe("この種類だけ"),
});

// ---- 結果 ----

export type SubscriptionResult = { ok: true; subscription: SubscriptionView; message: string } | { ok: false; errors: FieldError[] };
export type DeleteSubscriptionResult = { ok: true; deleted: SubscriptionView; message: string } | { ok: false; errors: FieldError[] };

export interface SubscriptionTotals {
  // 契約中の分だけの合計(月あたり・年あたり)。月あたりは、年あたりの合計÷12の四捨五入
  monthly: number;
  yearly: number;
  count: number;
}

export type ListSubscriptionsResult =
  | {
      ok: true;
      count: number;
      subscriptions: SubscriptionView[];
      // 契約中の合計(絞り込みに関わらず、契約中のもの全部ではなく、返した契約中のものの合計)
      totals: SubscriptionTotals;
      message: string;
    }
  | { ok: false; errors: FieldError[] };

const notFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: id「${id}」というサブスクはありません。list_subscriptions で id を確認してください` }],
});

const URL_MESSAGE = "url: https のURLだけ指定できます(空白・日本語、ポート番号、user:pass@ の付いたURLは使えません)";

// null / undefined はそのまま返す。正しければ正規化したURL、正しくなければ undefined(+エラー)
function normalizeUrl(url: string | null | undefined, errors: FieldError[]): string | null | undefined {
  if (url === null || url === undefined) return url;
  const normalized = parseHttpsUrl(url);
  if (normalized === null) {
    errors.push({ field: "url", message: URL_MESSAGE });
    return undefined;
  }
  return normalized;
}

const summarizeTotals = (items: readonly SubscriptionView[]): SubscriptionTotals => {
  const active = items.filter((s) => s.active);
  const yearly = active.reduce((sum, s) => sum + s.yearly_equivalent, 0);
  return { monthly: Math.round(yearly / 12), yearly, count: active.length };
};

// ---- 操作 ----

export async function addSubscription(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<SubscriptionResult> {
  const parsed = subscriptionFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const errors: FieldError[] = [];
  if (m.period === "monthly" && m.billing_month !== undefined) errors.push({ field: "billing_month", message: "billing_month: 月払いには指定できません(年払いの更新月です)" });
  const url = normalizeUrl(m.url, errors);
  if (errors.length > 0) return { ok: false, errors };

  const { count } = (await db.prepare("SELECT COUNT(*) AS count FROM subscriptions").first<{ count: number }>()) ?? { count: 0 };
  if (count >= MAX_SUBSCRIPTIONS) return { ok: false, errors: [{ field: "name", message: `登録は${MAX_SUBSCRIPTIONS}件までです` }] };

  const now = options.now ?? new Date();
  const today = todayJst(now);
  const nowIso = now.toISOString();
  const row: SubscriptionRow = {
    id: crypto.randomUUID(),
    name: m.name,
    kind: m.kind,
    amount: m.amount,
    period: m.period,
    billing_month: m.billing_month ?? null,
    billing_day: m.billing_day ?? null,
    previous_amount: null,
    amount_changed_on: null,
    // 登録した時点の金額は、確認した金額として今日の日付を入れる
    price_checked_on: today,
    url: url ?? null,
    note: m.note || null,
    active: m.active ? 1 : 0,
    created_at: nowIso,
    updated_at: nowIso,
  };
  await db
    .prepare(`INSERT INTO subscriptions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.name, row.kind, row.amount, row.period, row.billing_month, row.billing_day, row.previous_amount, row.amount_changed_on, row.price_checked_on, row.url, row.note, row.active, row.created_at, row.updated_at)
    .run();
  const view = toView(row, today);
  return { ok: true, subscription: view, message: `登録しました: ${row.name} ${yen(row.amount)}(${SUBSCRIPTION_PERIOD_LABELS[row.period]}。月あたり ${yen(view.monthly_equivalent)})` };
}

export async function updateSubscription(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<SubscriptionResult> {
  const parsed = updateSubscriptionFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, price_checked: priceChecked, ...patch } = parsed.data;
  if (Object.keys(patch).length === 0 && !priceChecked) {
    return { ok: false, errors: [{ field: "id", message: "更新する項目を1つ以上指定してください(name / amount / period / kind / billing_month / billing_day / url / note / active / price_checked)" }] };
  }
  const current = await db.prepare(`SELECT ${COLUMNS} FROM subscriptions WHERE id = ?`).bind(id).first<SubscriptionRow>();
  if (!current) return notFound(id);

  const now = options.now ?? new Date();
  const today = todayJst(now);
  const next: SubscriptionRow = { ...current };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.period !== undefined) next.period = patch.period;
  if (patch.billing_month !== undefined) next.billing_month = patch.billing_month;
  if (patch.billing_day !== undefined) next.billing_day = patch.billing_day;
  if (patch.note !== undefined) next.note = patch.note || null;
  if (patch.active !== undefined) next.active = patch.active ? 1 : 0;

  const errors: FieldError[] = [];
  if (next.period === "monthly" && next.billing_month !== null) {
    // 年払いから月払いに変えるときは、更新月を消すのを忘れないようにエラーにせず自動で消す
    if (patch.billing_month === undefined) next.billing_month = null;
    else errors.push({ field: "billing_month", message: "billing_month: 月払いには指定できません(年払いの更新月です)" });
  }
  const url = normalizeUrl(patch.url, errors);
  if (errors.length > 0) return { ok: false, errors };
  if (url !== undefined) next.url = url;

  let amountNote = "";
  if (patch.amount !== undefined) {
    if (patch.amount !== current.amount) {
      next.previous_amount = current.amount;
      next.amount_changed_on = today;
      amountNote = `。金額を ${yen(current.amount)} から ${yen(patch.amount)} に変えました`;
    }
    next.amount = patch.amount;
    next.price_checked_on = today;
  }
  if (priceChecked) next.price_checked_on = today;
  next.updated_at = now.toISOString();

  await db
    .prepare(
      `UPDATE subscriptions SET name = ?, kind = ?, amount = ?, period = ?, billing_month = ?, billing_day = ?, previous_amount = ?, amount_changed_on = ?, price_checked_on = ?, url = ?, note = ?, active = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(next.name, next.kind, next.amount, next.period, next.billing_month, next.billing_day, next.previous_amount, next.amount_changed_on, next.price_checked_on, next.url, next.note, next.active, next.updated_at, id)
    .run();
  const view = toView(next, today);
  return { ok: true, subscription: view, message: `更新しました: ${next.name} ${yen(next.amount)}(${SUBSCRIPTION_PERIOD_LABELS[next.period]}。月あたり ${yen(view.monthly_equivalent)})${amountNote}` };
}

export async function deleteSubscription(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<DeleteSubscriptionResult> {
  const parsed = deleteSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const current = await db.prepare(`SELECT ${COLUMNS} FROM subscriptions WHERE id = ?`).bind(id).first<SubscriptionRow>();
  if (!current) return notFound(id);
  await db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
  return { ok: true, deleted: toView(current, todayJst(options.now)), message: `削除しました: ${current.name}(解約しただけなら、削除ではなく active: false にすると記録が残ります)` };
}

export async function listSubscriptions(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<ListSubscriptionsResult> {
  const parsed = listSubscriptionsFieldsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { active, kind } = parsed.data;
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (active !== undefined) {
    where.push("active = ?");
    binds.push(active ? 1 : 0);
  }
  if (kind !== undefined) {
    where.push("kind = ?");
    binds.push(kind);
  }
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM subscriptions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY active DESC, name, id LIMIT ?`)
    .bind(...binds, MAX_SUBSCRIPTIONS)
    .all<SubscriptionRow>();
  const today = todayJst(options.now);
  const subscriptions = results.map((r) => toView(r, today));
  const totals = summarizeTotals(subscriptions);
  const message =
    subscriptions.length === 0
      ? "登録されたサブスクはありません"
      : `契約中 ${totals.count}件: 月あたり ${yen(totals.monthly)}、年あたり ${yen(totals.yearly)}(年払いは月あたりに直した合計)`;
  return { ok: true, count: subscriptions.length, subscriptions, totals, message };
}
