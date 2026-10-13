import { z } from "zod";
import { todayJst } from "./dates";
import { toFieldErrors, type FieldError } from "./schema";
import { summarize } from "./summarize";
import type { CoreOptions } from "./transactions";

// 月の比較。指定した月(既定は今月)を、先月・前年の同じ月・好きな月と、大分類(またはカテゴリ)ごとに比べる。読み取り専用。
// 今月が途中のときは、until_day で「どちらも◯日まで」にそろえて比べられる(月末までの先月と比べると、必ず減って見えるため)。

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthField = z.string().regex(MONTH, "YYYY-MM 形式で指定してください(例: 2026-10)");

export const compareSchema = z.strictObject({
  month: monthField.optional().describe("比べる月(YYYY-MM)。省略すると今月"),
  base: z
    .union([z.enum(["previous", "year_ago"]), monthField])
    .default("previous")
    .describe("比べる相手。previous=先月(既定)、year_ago=前年の同じ月、または YYYY-MM(好きな月)"),
  group_by: z.enum(["group", "category"]).default("group").describe("比べる単位。group=大分類(既定)、category=カテゴリ"),
  until_day: z
    .number({ error: "until_day は1〜31の整数で指定してください" })
    .int("until_day は1〜31の整数で指定してください")
    .min(1, "until_day は1〜31の整数で指定してください")
    .max(31, "until_day は1〜31の整数で指定してください")
    .optional()
    .describe("両方の月を、この日(1〜31)までにそろえて比べる。途中の月を、先月の同じ日までと比べるときに使う。月の最終日を超える分は月末まで"),
});

export interface CompareRow {
  key: string;
  label: string;
  total: number;
  base_total: number;
  // total - base_total(増えたら正)
  diff: number;
  // 増減の割合(%)。小数第1位。比べる側が0円以下のときは null
  diff_percent: number | null;
}

export type CompareResult =
  | {
      ok: true;
      month: string;
      base_month: string;
      group_by: "group" | "category";
      // 日数をそろえたときの日(なければ null)
      until_day: number | null;
      // 期間(両端を含む)
      period: { from: string; to: string };
      base_period: { from: string; to: string };
      total: number;
      base_total: number;
      diff: number;
      diff_percent: number | null;
      count: number;
      base_count: number;
      rows: CompareRow[];
      message: string;
    }
  | { ok: false; errors: FieldError[] };

const fail = (field: string, message: string): CompareResult => ({ ok: false, errors: [{ field, message }] });

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// 月を n か月ずらす(YYYY-MM)
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

const range = (month: string, untilDay: number | undefined) => {
  const day = Math.min(untilDay ?? 31, lastDay(month));
  return { from: `${month}-01`, to: `${month}-${String(day).padStart(2, "0")}` };
};

const percentChange = (diff: number, base: number) => (base > 0 ? Math.round((diff / base) * 1000) / 10 : null);
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${yen(Math.abs(n))}`;

export async function compareMonths(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<CompareResult> {
  const parsed = compareSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { base, group_by: groupBy, until_day: untilDay } = parsed.data;
  const month = parsed.data.month ?? todayJst(options.now).slice(0, 7);
  const baseMonth = base === "previous" ? shiftMonth(month, -1) : base === "year_ago" ? shiftMonth(month, -12) : base;
  if (baseMonth === month) return fail("base", "base: 比べる月が同じ月です。別の月を指定してください");

  const period = range(month, untilDay);
  const basePeriod = range(baseMonth, untilDay);
  const [cur, prev] = await Promise.all([summarize(db, { ...period, group_by: groupBy }), summarize(db, { ...basePeriod, group_by: groupBy })]);
  if (!cur.ok) return cur;
  if (!prev.ok) return prev;

  const rows = new Map<string, CompareRow>();
  for (const r of cur.rows) rows.set(r.key, { key: r.key, label: r.label, total: r.total, base_total: 0, diff: 0, diff_percent: null });
  for (const r of prev.rows) {
    const row = rows.get(r.key) ?? { key: r.key, label: r.label, total: 0, base_total: 0, diff: 0, diff_percent: null };
    row.base_total = r.total;
    rows.set(r.key, row);
  }
  const list = [...rows.values()].map((r) => ({ ...r, diff: r.total - r.base_total, diff_percent: percentChange(r.total - r.base_total, r.base_total) }));
  // 今月の金額の大きい順、同じなら比べる月の大きい順
  list.sort((a, b) => b.total - a.total || b.base_total - a.base_total || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const diff = cur.total - prev.total;
  const scope = untilDay ? `どちらも${untilDay}日まで` : "月全体";
  return {
    ok: true,
    month,
    base_month: baseMonth,
    group_by: groupBy,
    until_day: untilDay ?? null,
    period,
    base_period: basePeriod,
    total: cur.total,
    base_total: prev.total,
    diff,
    diff_percent: percentChange(diff, prev.total),
    count: cur.count,
    base_count: prev.count,
    rows: list,
    message: `${month} は ${baseMonth} より ${signed(diff)}(${yen(cur.total)} と ${yen(prev.total)}、${scope})`,
  };
}
