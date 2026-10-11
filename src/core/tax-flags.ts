import { z } from "zod";

// 税金の控除用フラグ。1つの取引に1つ。フラグなしは null
// 金額の記録と集計のためだけで、控除額の判定や上限の案内はしない(判定は利用者の責任)
export const TAX_FLAGS = ["medical", "self_medication", "donation"] as const;
export type TaxFlag = (typeof TAX_FLAGS)[number];

// UI(ui/src/taxFlags.ts)にも同じ文言がある。tests/ui/tax-flag.test.ts が一致を確かめる
export const TAX_FLAG_LABELS: Record<TaxFlag, string> = {
  medical: "医療費控除",
  self_medication: "セルフメディケーション税制",
  donation: "寄附金控除",
};

export const NO_TAX_FLAG_LABEL = "(フラグなし)";

// list_transactions の絞り込みで、何かのフラグがあるものを表す値
export const ANY_TAX_FLAG = "any";
export const TAX_FLAG_FILTERS = [...TAX_FLAGS, ANY_TAX_FLAG] as const;

const choices = TAX_FLAGS.map((f) => `${f}=${TAX_FLAG_LABELS[f]}`).join("、");

// MCPの説明文で共有する、選べる値の説明
export const TAX_FLAG_CHOICES = choices;

const invalid = `tax_flag は ${TAX_FLAGS.join(" / ")} のいずれかで指定してください(なしにするなら省略か null)`;

export const taxFlagSchema = z.enum(TAX_FLAGS, { error: invalid });

export const TAX_FLAG_DESCRIPTION = [
  `税金の控除用フラグ。${choices}。1つの取引に1つ。控除に関係なければ省略する。`,
  "薬局のレシートは medical か self_medication を付ける(どちらにするか、控除の対象になるかは利用者の判断。このフラグは金額の記録と年ごとの集計のためで、控除額の判定はしない)。",
  "ふるさと納税などの寄附は donation。",
].join("");

export const TAX_FLAG_FILTER_DESCRIPTION = `税金の控除用フラグで絞り込む。${choices}。"${ANY_TAX_FLAG}" で何かのフラグが付いたもの全部。省略すると絞り込まない`;
