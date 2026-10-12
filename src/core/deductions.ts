import { z } from "zod";
import { spendLines } from "./items";
import { isoDate, toFieldErrors, type FieldError } from "./schema";

// 確定申告の参考の集計(読み取り専用)。税金の控除用フラグ(tax_flag)が付いた支出の合計だけを出す。
// 控除の対象になるか・控除額・上限の判定はしない(判定は利用者の責任)。数えるのは支出の行(明細があれば行ごとの実効フラグ・実効カテゴリ)

// 「交通費」とみなす大分類の名前(カテゴリの大分類 group_name がこれと一致する行)。病院の駐車場代・通院の電車代など
export const TRANSPORT_GROUP = "交通";

export const deductionsSchema = z.strictObject({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export interface DeductionAmount {
  total: number;
  // 支出の行の数(明細のない取引は1行)
  count: number;
}

export type DeductionsResult =
  | {
      ok: true;
      from: string | null;
      to: string | null;
      // セルフメディケーション税制(tax_flag = self_medication)の合計
      self_medication: DeductionAmount;
      // 医療費控除(tax_flag = medical)の合計。交通費を含む / 含まない、と、その差の交通費
      medical: {
        including_transport: DeductionAmount;
        excluding_transport: DeductionAmount;
        transport: DeductionAmount;
      };
      // 交通費とみなす大分類の名前
      transport_group: string;
    }
  | { ok: false; errors: FieldError[] };

interface Row {
  tax_flag: string;
  transport: number;
  total: number;
  count: number;
}

export async function summarizeDeductions(db: D1Database, input: unknown): Promise<DeductionsResult> {
  const parsed = deductionsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { from, to } = parsed.data;
  if (from && to && from > to) return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };

  const conds: string[] = [];
  const params: string[] = [];
  if (from) {
    conds.push("t.date >= ?");
    params.push(from);
  }
  if (to) {
    conds.push("t.date <= ?");
    params.push(to);
  }
  const lines = spendLines(conds, params);
  const { results } = await db
    .prepare(
      `SELECT l.tax_flag AS tax_flag, CASE WHEN c.group_name = ? THEN 1 ELSE 0 END AS transport, COALESCE(SUM(l.amount), 0) AS total, COUNT(*) AS count
       FROM ${lines.sql} l LEFT JOIN categories c ON c.id = l.category_id
       WHERE l.tax_flag IN ('medical', 'self_medication')
       GROUP BY l.tax_flag, transport`,
    )
    .bind(TRANSPORT_GROUP, ...lines.params)
    .all<Row>();

  const sum = (pick: (r: Row) => boolean): DeductionAmount =>
    results.filter(pick).reduce((a, r) => ({ total: a.total + r.total, count: a.count + r.count }), { total: 0, count: 0 });

  return {
    ok: true,
    from: from ?? null,
    to: to ?? null,
    self_medication: sum((r) => r.tax_flag === "self_medication"),
    medical: {
      including_transport: sum((r) => r.tax_flag === "medical"),
      excluding_transport: sum((r) => r.tax_flag === "medical" && r.transport === 0),
      transport: sum((r) => r.tax_flag === "medical" && r.transport === 1),
    },
    transport_group: TRANSPORT_GROUP,
  };
}
