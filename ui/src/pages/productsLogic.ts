import type { ContentUnit, ProductRowView, UnitPrice } from "../../../src/api/contract";

// 商品の画面の純粋な部分(DOMに触れない。テストする)

// 単価の表示の単位(「100mlあたり」「1Lあたり」など)。g・ml は 1 / 100 / 1000、個 は 1 だけ。1000 は kg・L と書く
export const PER_OPTIONS: Record<ContentUnit, number[]> = { g: [1, 100, 1000], ml: [1, 100, 1000], 個: [1] };
export const DEFAULT_PER: Record<ContentUnit, number> = { g: 100, ml: 100, 個: 1 };

export function perLabel(unit: ContentUnit, per: number): string {
  if (unit === "個") return "1個";
  if (per === 1000) return unit === "g" ? "1kg" : "1L";
  return `${per}${unit}`;
}

// 選んだ単位が、その単位で使える値か(使えなければ既定)
export function normalizePer(unit: ContentUnit, per: number | null | undefined): number {
  return per != null && PER_OPTIONS[unit].includes(per) ? per : DEFAULT_PER[unit];
}

// 円の表示。100円以上は整数、1円以上は小数第1位まで、1円未満は小数第2位まで(余分な0は付けない)
export function formatUnitYen(n: number): string {
  const digits = n >= 100 ? 0 : n >= 1 ? 1 : 2;
  return `¥${n.toLocaleString("ja-JP", { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}

/** 単価の文言。「100mlあたり ¥19.8」「1個あたり ¥25」。per は表示の単位(省略は既定) */
export function unitPriceLabel(up: UnitPrice, per?: number | null): string {
  const p = normalizePer(up.unit, per);
  return `${perLabel(up.unit, p)}あたり ${formatUnitYen(up.per_unit * p)}`;
}

/** 明細の行の補足(「×2 ・ 1000ml ・ 100mlあたり ¥19.8」)。無ければ null */
export function itemProductLine(
  it: { quantity: number | null; content_amount: number | null; content_unit: ContentUnit | null; unit_price: UnitPrice | null },
  per?: number | null,
): string | null {
  const parts: string[] = [];
  if (it.quantity !== null && it.quantity !== 1) parts.push(`×${it.quantity}`);
  if (it.content_amount !== null && it.content_unit !== null) parts.push(`${it.content_amount.toLocaleString("ja-JP")}${it.content_unit}`);
  if (it.unit_price) parts.push(unitPriceLabel(it.unit_price, per));
  return parts.length > 0 ? parts.join(" ・ ") : null;
}

/** 購入数の表示(整数なら整数、小数なら3桁まで) */
export const quantityText = (n: number): string => n.toLocaleString("ja-JP", { maximumFractionDigits: 3 });

export interface ProductDelta {
  quantity: number;
  // 先月の購入数(先月に無ければ 0)
  previous: number;
  diff: number;
}

/** 今月と先月の商品一覧を合わせる(今月の金額の大きい順を保つ。先月だけの商品は含めない) */
export function withPrevious(current: readonly ProductRowView[], previous: readonly ProductRowView[]): (ProductRowView & ProductDelta)[] {
  const prev = new Map(previous.map((p) => [p.product, p.quantity]));
  return current.map((p) => {
    const before = prev.get(p.product) ?? 0;
    return { ...p, previous: before, diff: Math.round((p.quantity - before) * 1000) / 1000 };
  });
}

/** 先月との購入数の差の文言(「+2」「-1」「±0」「先月は買っていない」) */
export function diffText(d: Pick<ProductDelta, "previous" | "diff">): string {
  if (d.previous === 0) return "先月は買っていない";
  if (d.diff === 0) return "先月と同じ";
  return `先月より ${d.diff > 0 ? "+" : "−"}${quantityText(Math.abs(d.diff))}`;
}

export interface MonthCell {
  month: string;
  quantity: number;
  amount: number;
  unit_price: UnitPrice | null;
  // データのある月か(買わなかった月は false。0 で並べる)
  bought: boolean;
}

/** 直近 count か月(endMonth まで。古い順)に、月ごとの集計を当てはめる。買わなかった月は 0 で入れる */
export function monthlyCells(
  months: readonly { month: string; quantity: number; amount: number; unit_price: UnitPrice | null }[],
  endMonth: string,
  count: number,
  shift: (month: string, delta: number) => string,
): MonthCell[] {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const out: MonthCell[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shift(endMonth, -i);
    const m = byMonth.get(month);
    out.push(m ? { month, quantity: m.quantity, amount: m.amount, unit_price: m.unit_price, bought: true } : { month, quantity: 0, amount: 0, unit_price: null, bought: false });
  }
  return out;
}

/** 棒の長さ(%)。最大の月を100%にする。0 は 0 */
export function quantityBar(quantity: number, max: number): number {
  if (!(quantity > 0) || !(max > 0)) return 0;
  return Math.max(3, Math.min(100, (quantity / max) * 100));
}
