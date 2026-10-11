import type { TaxFlag } from "../../src/api/contract";

// 税金の控除用フラグの日本語ラベル。src/core/tax-flags.ts の TAX_FLAG_LABELS と同じ文言
// (UI は core を import しない決まりなので、ここに持つ。tests/ui/tax-flag.test.ts が一致を確かめる)
export const UI_TAX_FLAG_LABELS: Record<TaxFlag, string> = {
  medical: "医療費控除",
  self_medication: "セルフメディケーション税制",
  donation: "寄附金控除",
};
