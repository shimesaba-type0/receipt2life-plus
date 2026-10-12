// 店名の候補(インクリメンタルサーチ)の純関数。DOM に触れない。テストする
import type { CategoriesData, MerchantView } from "../../src/api/contract";
import type { TxFormValues } from "./pages/transactionLogic";

// 入力から API を呼ぶまでの待ち(ミリ秒)と、候補の最大数
export const SUGGEST_DEBOUNCE_MS = 150;
export const SUGGEST_LIMIT = 8;
const MAX_QUERY = 100;

// 入力 → GET /api/merchants のパス。前後の空白を除き、空なら null(候補は出さない)。長すぎる入力は先頭 100 文字
export function merchantsPath(raw: string, limit: number = SUGGEST_LIMIT): string | null {
  const q = raw.trim().slice(0, MAX_QUERY).trim();
  if (q === "") return null;
  return `/api/merchants?q=${encodeURIComponent(q)}&limit=${limit}`;
}

// 上下キーで選択を動かす。-1 は「選んでいない」。端で折り返す。候補が 0 件なら -1
export function moveActive(current: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return current < 0 || current >= count - 1 ? 0 : current + 1;
  return current <= 0 ? count - 1 : current - 1;
}

// IME の変換中の Enter は決定にしない(変換の確定に使われるため)。isComposing / keyCode 229 / compositionstart〜end の記録のどれかで判定
export function isImeEnter(e: { key: string; isComposing?: boolean; keyCode?: number }, composing: boolean): boolean {
  return e.key === "Enter" && (composing || e.isComposing === true || e.keyCode === 229);
}

// 「10月7日」。今年でなければ「2025年10月7日」。日付の形でなければそのまま
export function lastUsedLabel(date: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const md = `${Number(m[2])}月${Number(m[3])}日`;
  return m[1] === today.slice(0, 4) ? md : `${Number(m[1])}年${md}`;
}

export const usageLabel = (count: number): string => `${count}回`;

// 候補の読み上げ用のまとめ(スクリーンリーダーは option の中身を順に読むので、補助として aria-label に使う)
export function optionLabel(m: MerchantView, today: string): string {
  const parts = [m.merchant];
  if (m.category) parts.push(m.category);
  if (m.phone) parts.push(`電話 ${m.phone}`);
  parts.push(`最後 ${lastUsedLabel(m.last_date, today)}`, usageLabel(m.count));
  return parts.join("、");
}

type AutofillKey = "category" | "account" | "merchant_phone" | "merchant_address" | "invoice_number";

// 画面に出す順と、通知に使う名前
const AUTOFILL_FIELDS: { key: AutofillKey; label: string }[] = [
  { key: "category", label: "カテゴリ" },
  { key: "account", label: "支払方法" },
  { key: "merchant_phone", label: "電話番号" },
  { key: "merchant_address", label: "住所" },
  { key: "invoice_number", label: "事業者登録番号" },
];

export interface AutofillPlan {
  // 店名を含めて、フォームに入れる値
  patch: Partial<TxFormValues>;
  // 入れた欄の名前(通知用。入れなかった欄は含まない)
  filled: string[];
}

/**
 * 候補を選んだときの自動入力。すでに入力した欄(空白だけは空とみなす)は上書きせず、空欄にだけ入れる。
 * カテゴリ・口座は、いま選べる名前(cats)にあるものだけ入れる。店名は選んだ候補の名前にそろえる。
 */
export function planAutofill(values: Pick<TxFormValues, AutofillKey>, m: MerchantView, cats: Pick<CategoriesData, "categories" | "accounts">): AutofillPlan {
  const source: Record<AutofillKey, string | null> = {
    category: m.category !== null && cats.categories.some((c) => c.name === m.category) ? m.category : null,
    account: m.account !== null && cats.accounts.includes(m.account) ? m.account : null,
    merchant_phone: m.phone,
    merchant_address: m.address,
    invoice_number: m.invoice_number,
  };
  const patch: Partial<TxFormValues> = { merchant: m.merchant };
  const filled: string[] = [];
  for (const { key, label } of AUTOFILL_FIELDS) {
    const next = source[key];
    if (next === null || next.trim() === "") continue;
    if (values[key].trim() !== "") continue;
    patch[key] = next;
    filled.push(label);
  }
  return { patch, filled };
}

// 「前回の内容を入れました: カテゴリ、支払方法」。入れた欄が無ければ null
export function autofillNotice(filled: string[]): string | null {
  return filled.length === 0 ? null : `前回の内容を入れました: ${filled.join("、")}`;
}
