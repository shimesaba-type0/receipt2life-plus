import { z } from "zod";
import type { FieldError } from "./schema";

// 明細の行の、商品の情報(migration 0018)。商品名・買った数・1つあたりの内容量と単位。
// 目的: ①単価(100mlあたり・1個あたり)の自動計算と、その推移 ②特定の商品を毎月どれだけ買ったか。
// 入力の手間を増やさないため、すべて任意。レシート写真や品名(「卵 10個入」「牛乳 1L」)から AI が補う想定。分からない行には入れない(推測しない)

export const CONTENT_UNITS = ["g", "ml", "個"] as const;
export type ContentUnit = (typeof CONTENT_UNITS)[number];
export const MAX_PRODUCT_NAME = 50;
export const MAX_QUANTITY = 10_000;
export const MAX_CONTENT_AMOUNT = 10_000_000;

const hasAtMostDecimals = (n: number, places: number) => Math.abs(Math.round(n * 10 ** places) - n * 10 ** places) < 1e-6;

export const productField = z
  .string({ error: "商品名(product)は文字列で指定してください" })
  .trim()
  .max(MAX_PRODUCT_NAME, `商品名は${MAX_PRODUCT_NAME}文字以内にしてください`);

export const quantityField = z
  .number({ error: "買った数(quantity)は数値で指定してください" })
  .positive("買った数は0より大きい数にしてください")
  .max(MAX_QUANTITY, `買った数は${MAX_QUANTITY.toLocaleString("ja-JP")}以下にしてください`)
  .refine((v) => hasAtMostDecimals(v, 3), "買った数は小数点以下3桁までにしてください");

export const contentAmountField = z
  .number({ error: "内容量(content_amount)は数値で指定してください" })
  .positive("内容量は0より大きい数にしてください")
  .max(MAX_CONTENT_AMOUNT, `内容量は${MAX_CONTENT_AMOUNT.toLocaleString("ja-JP")}以下にしてください`)
  .refine((v) => hasAtMostDecimals(v, 3), "内容量は小数点以下3桁までにしてください");

export const contentUnitField = z.enum(CONTENT_UNITS, { error: `content_unit は ${CONTENT_UNITS.join(" / ")} のいずれかで指定してください` });

// 明細の行に足す項目(すべて任意・null可)
export const itemProductShape = {
  product: productField
    .nullable()
    .optional()
    .describe(
      `統一した商品名(${MAX_PRODUCT_NAME}文字まで。任意)。店・メーカー・容量が違っても同じ商品として数えたい名前を付ける(例: 「牛乳」「卵」「食パン」)。品名(name)がレシートの表記のままなのに対して、こちらは集計用。毎月の購入数や単価の推移は、この名前(無ければ品名)でまとまる。商品だと分からない行(値引き・袋・サービス料など)には付けない`,
    ),
  quantity: quantityField
    .nullable()
    .optional()
    .describe("買った数(例: 牛乳を2本なら 2)。レシートの「2点」「×2」から。省略すると1として数える。内容量が2倍になる意味ではなく、同じ商品を何個(本・パック)買ったか"),
  content_amount: contentAmountField
    .nullable()
    .optional()
    .describe("1つ(1パック・1本)あたりの内容量(例: 牛乳1Lなら 1000、卵10個入りなら 10、鶏肉300gなら 300)。品名や写真から分かる場合だけ。分からなければ省略(推測しない)。content_unit とセット"),
  content_unit: contentUnitField
    .nullable()
    .optional()
    .describe("内容量の単位。g=重さ(1kg は 1000g にする)、ml=容量(1L は 1000ml にする)、個=個数(卵10個入りなら 個)。content_amount とセット"),
};

// 内容量と単位は、両方あるか両方ないか。片方だけなら、その行の項目名つきのエラー
export function checkItemProducts(
  items: readonly { content_amount?: number | null; content_unit?: ContentUnit | null }[],
  index?: number,
): FieldError[] {
  const errors: FieldError[] = [];
  items.forEach((item, k) => {
    const hasAmount = item.content_amount != null;
    const hasUnit = item.content_unit != null;
    if (hasAmount !== hasUnit) {
      errors.push({
        ...(index !== undefined ? { index } : {}),
        field: `items.${k}.${hasAmount ? "content_unit" : "content_amount"}`,
        message: `items.${k}.${hasAmount ? "content_unit" : "content_amount"}: 内容量(content_amount)と単位(content_unit)は、両方指定するか、両方省いてください`,
      });
    }
  });
  return errors;
}

export interface UnitPrice {
  // 基準の単位あたりの金額(円)。g・ml・個 の1あたり
  per_unit: number;
  unit: ContentUnit;
}

/**
 * 単価。行の金額 ÷ (買った数 × 内容量)。内容量が無い行・値引きの行(金額がマイナス)は null。
 * 1gあたり・1mlあたり・1個あたりで返す(100mlあたりなどは、表示のときに掛ける)
 */
export function computeUnitPrice(item: { amount: number; quantity?: number | null; content_amount?: number | null; content_unit?: ContentUnit | null }): UnitPrice | null {
  if (item.amount <= 0 || item.content_amount == null || item.content_unit == null) return null;
  const total = (item.quantity ?? 1) * item.content_amount;
  if (!(total > 0)) return null;
  return { per_unit: item.amount / total, unit: item.content_unit };
}
