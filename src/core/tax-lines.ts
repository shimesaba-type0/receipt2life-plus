import { z } from "zod";

// レシートに印字された税率と税額(migration 0012)。検証はここの Zod スキーマ1つで、add / update / API / JSONL の取り込みを兼ねる
// 方針: レシートがマスター。印字された数字をそのまま記録し、こちらで税額を計算して補わない。税率の表も持たない
// (税率は変わる。8・10・0 のほか、1 や 0.5 のような数字もそのまま入る)
// 税金の控除用フラグ(tax_flag。医療費控除など)とは別物

export const MAX_TAX_RATE = 100;
export const MAX_TAX_LABEL = 20;
// 1取引あたりの税の内訳の行数(税率ごとに1行)
export const MAX_TAX_LINES = 10;
// 金額の上限(取引の金額と同じ)
const MAX_TAX_YEN = 10_000_000;
export const AMOUNT_BASES = ["included", "excluded"] as const;
export type AmountBasis = (typeof AMOUNT_BASES)[number];

export const TAX_RATE_MESSAGE = `税率は0〜${MAX_TAX_RATE}の数(%。小数は第3位まで。例: 10、8、0.5)で指定してください`;

// 小数第3位までか(浮動小数の誤差は許す)
const hasAtMost3Decimals = (n: number) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6;

export const taxRateField = z
  .number({ error: TAX_RATE_MESSAGE })
  .min(0, TAX_RATE_MESSAGE)
  .max(MAX_TAX_RATE, TAX_RATE_MESSAGE)
  .refine(hasAtMost3Decimals, TAX_RATE_MESSAGE);

// 印字どおりの記号(「※」「軽」「(軽)」など)。前後の空白を除く。空文字は保存のときに「値なし」(null)にする(blankToNull)
export const taxLabelField = z
  .string({ error: "印字の記号は文字列で指定してください" })
  .trim()
  .max(MAX_TAX_LABEL, `印字の記号は${MAX_TAX_LABEL}文字以内にしてください`);

export const blankToNull = (s: string | null | undefined): string | null => (s ? s : null);

const yenField = (label: string) =>
  z
    .number({ error: `${label}は数値(円・整数)で指定してください` })
    .int(`${label}は整数(円)で指定してください`)
    .min(0, `${label}は0円以上で指定してください`)
    .max(MAX_TAX_YEN, `${label}は${MAX_TAX_YEN.toLocaleString("ja-JP")}円以下で指定してください`);

export const TAX_RATE_DESCRIPTION =
  "この行の税率(%)。レシートに印字された数字をそのまま入れる(8、10、1 など。計算しない)。軽減税率の記号(※・＊・軽 など)は店ごとに書き方が違うので、凡例(「※は軽減税率対象」など)を読んで数字にする。分からなければ省略し、推測しない。省略または null で不明";
export const TAX_LABEL_DESCRIPTION = `この行に印字された税率の記号(「※」「軽」など。${MAX_TAX_LABEL}文字まで。任意)。印字のまま残したいときに入れる`;

// 明細の行に足す項目(すべて任意・null可)
export const itemTaxShape = {
  tax_rate: taxRateField.nullable().optional().describe(TAX_RATE_DESCRIPTION),
  tax_label: taxLabelField.nullable().optional().describe(TAX_LABEL_DESCRIPTION),
};

// 税の内訳の1行(レシート下部の「10%対象 ¥1,100 消費税 ¥100」など)
export const taxLineInputSchema = z
  .strictObject({
    rate: taxRateField.describe("税率(%)。印字された数字をそのまま(10、8、1、0 など)。必須"),
    taxable_amount: yenField("対象金額")
      .nullable()
      .optional()
      .describe("その税率の対象金額(円・整数。「10%対象 ¥1,100」の 1,100)。印字が無ければ省略"),
    tax_amount: yenField("消費税額")
      .nullable()
      .optional()
      .describe("その税率の消費税額(円・整数。「(内)消費税 ¥100」「消費税等 ¥80」など)。印字が無ければ省略"),
    amount_basis: z
      .enum(AMOUNT_BASES, { error: "amount_basis は included(税込)か excluded(税抜)で指定してください" })
      .nullable()
      .optional()
      .describe("対象金額が税込か税抜か。included=税込(内税。「(内)消費税」など)、excluded=税抜(外税)。印字から分かるときだけ入れ、分からなければ省略する(推測しない)"),
    label: taxLabelField.nullable().optional().describe(`この税率の印字の記号(「※」「軽」など。${MAX_TAX_LABEL}文字まで。任意)`),
  })
  .describe("税の内訳の1行(税率ごと)");

export const taxLinesSchema = z
  .array(taxLineInputSchema)
  .max(MAX_TAX_LINES, `tax_lines(税の内訳)は1取引あたり${MAX_TAX_LINES}行までです`)
  .superRefine((lines, ctx) => {
    const seen = new Map<number, number>();
    lines.forEach((l, k) => {
      const first = seen.get(l.rate);
      if (first !== undefined) {
        ctx.addIssue({ code: "custom", path: [k, "rate"], message: `税率 ${l.rate}% の行が2つあります(${first}行目と${k}行目。0始まり)。税率ごとに1行にしてください` });
      } else {
        seen.set(l.rate, k);
      }
    });
  });

export type TaxLineInput = z.infer<typeof taxLineInputSchema>;

export const TAX_LINES_DESCRIPTION = [
  "税の内訳(任意)。レシート下部の税率別の内訳(「10%対象 ¥1,100 消費税 ¥100」「8%対象 ¥540 (内)消費税 ¥40」など)を、税率ごとに1行ずつ、印字どおりに入れる。",
  "各行は rate(税率%・必須)、taxable_amount(対象金額)、tax_amount(消費税額)、amount_basis(対象金額が税込なら included、税抜なら excluded。分かるときだけ)、label(印字の記号)。",
  "こちらで税額を計算して補わない(印字が無い数字は省略する)。同じ税率の行は1つだけ。合計が取引の金額と合わなくてもエラーにはせず、tax_warnings で知らせる。",
  `内税・外税の別が分からない、記号の意味が分からない、印字が薄い場合は、推測せずユーザーに聞く。${MAX_TAX_LINES}行まで`,
].join("");

export interface TaxLineView {
  id: string;
  // 税率(%)。印字どおり
  rate: number;
  taxable_amount: number | null;
  tax_amount: number | null;
  amount_basis: AmountBasis | null;
  label: string | null;
}

export interface TaxWarning {
  index?: number;
  field: string;
  message: string;
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

// 税の内訳と取引の金額の食い違いを、警告として返す(エラーにはしない。レシートがマスター)
// 全行が税込(included)で対象金額がそろっているときは「対象金額の合計 = 金額」、全行が税抜(excluded)で対象金額と税額がそろっているときは
// 「対象金額 + 税額の合計 = 金額」を確かめる。それ以外(混在・不明・欠け)は確かめない
export function taxLineWarnings(amount: number, lines: readonly Pick<TaxLineInput, "taxable_amount" | "tax_amount" | "amount_basis">[], index?: number): TaxWarning[] {
  if (lines.length === 0) return [];
  const at = index !== undefined ? { index } : {};
  const field = "tax_lines";
  if (lines.every((l) => l.amount_basis === "included" && l.taxable_amount != null)) {
    const sum = lines.reduce((s, l) => s + (l.taxable_amount ?? 0), 0);
    if (sum !== amount) {
      return [{ ...at, field, message: `税の内訳の対象金額(税込)の合計 ${yen(sum)} が、金額 amount ${yen(amount)} と一致しません(差 ${yen(Math.abs(sum - amount))})。印字どおりならこのままで構いません。読み取りを見直すか、利用者に確認してください` }];
    }
  } else if (lines.every((l) => l.amount_basis === "excluded" && l.taxable_amount != null && l.tax_amount != null)) {
    const sum = lines.reduce((s, l) => s + (l.taxable_amount ?? 0) + (l.tax_amount ?? 0), 0);
    if (sum !== amount) {
      return [{ ...at, field, message: `税の内訳の対象金額(税抜)と税額の合計 ${yen(sum)} が、金額 amount ${yen(amount)} と一致しません(差 ${yen(Math.abs(sum - amount))})。印字どおりならこのままで構いません。読み取りを見直すか、利用者に確認してください` }];
    }
  }
  return [];
}

// ---- 読み書き ----

// D1: 1文あたりのバインド変数は100個まで。IN句は余裕をみて90個ずつ
const IN_CHUNK = 90;

// 取引の id ごとの税の内訳(税率の高い順)。内訳が無い取引はマップに入らない
export async function loadTaxLines(db: D1Database, transactionIds: readonly string[]): Promise<Map<string, TaxLineView[]>> {
  const out = new Map<string, TaxLineView[]>();
  const ids = [...new Set(transactionIds)];
  for (let k = 0; k < ids.length; k += IN_CHUNK) {
    const part = ids.slice(k, k + IN_CHUNK);
    const { results } = await db
      .prepare(
        `SELECT transaction_id, id, rate, taxable_amount, tax_amount, amount_basis, label
         FROM transaction_tax_lines
         WHERE transaction_id IN (${part.map(() => "?").join(",")})
         ORDER BY transaction_id, rate DESC, id`,
      )
      .bind(...part)
      .all<TaxLineView & { transaction_id: string }>();
    for (const { transaction_id: txId, ...line } of results) {
      const list = out.get(txId) ?? [];
      list.push(line);
      out.set(txId, list);
    }
  }
  return out;
}

// 入力の行を、保存する形(id つき、税率の高い順)にする
export function toStoredTaxLines(lines: readonly TaxLineInput[]): TaxLineView[] {
  return lines
    .map((l) => ({
      id: crypto.randomUUID(),
      rate: l.rate,
      taxable_amount: l.taxable_amount ?? null,
      tax_amount: l.tax_amount ?? null,
      amount_basis: l.amount_basis ?? null,
      label: blankToNull(l.label),
    }))
    .sort((a, b) => b.rate - a.rate);
}

export function insertTaxLineStatements(db: D1Database, transactionId: string, lines: readonly TaxLineView[], createdAt: string): D1PreparedStatement[] {
  return lines.map((l) =>
    db
      .prepare(
        `INSERT INTO transaction_tax_lines (id, transaction_id, rate, taxable_amount, tax_amount, amount_basis, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(l.id, transactionId, l.rate, l.taxable_amount, l.tax_amount, l.amount_basis, l.label, createdAt),
  );
}
