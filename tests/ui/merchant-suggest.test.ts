import { describe, expect, it } from "vitest";
import type { MerchantView } from "../../src/api/contract";
import { autofillNotice, isImeEnter, lastUsedLabel, merchantsPath, moveActive, optionLabel, planAutofill, usageLabel } from "../../ui/src/merchantSuggest";
import { emptyTxForm } from "../../ui/src/pages/transactionLogic";

// 店名の候補の純関数。店名・電話はダミー
const cats = {
  categories: [
    { name: "食費", group_name: "食費", icon: null, usage: 0 },
    { name: "日用品", group_name: "生活", icon: null, usage: 0 },
  ],
  accounts: ["現金", "カード"],
};

const merchant = (over: Partial<MerchantView> = {}): MerchantView => ({
  merchant: "Aストア",
  count: 3,
  last_date: "2026-10-07",
  category: "食費",
  account: "カード",
  phone: "03-0000-1111",
  address: "東京都〇〇区1-2-3",
  invoice_number: "T0000000000000",
  ...over,
});

describe("merchantsPath", () => {
  it("前後の空白を除き、エンコードして limit を付ける。空は null", () => {
    expect(merchantsPath("  A店 ")).toBe("/api/merchants?q=A%E5%BA%97&limit=8");
    expect(merchantsPath("03-12", 5)).toBe("/api/merchants?q=03-12&limit=5");
    expect(merchantsPath("a&b=c")).toBe("/api/merchants?q=a%26b%3Dc&limit=8");
    expect(merchantsPath("")).toBeNull();
    expect(merchantsPath("   　")).toBeNull();
  });
  it("長すぎる入力は先頭100文字にする", () => {
    expect(decodeURIComponent(merchantsPath("a".repeat(150))!.split("q=")[1]!.split("&")[0]!)).toHaveLength(100);
  });
});

describe("moveActive", () => {
  it("下は次へ(最後から先頭へ折り返す)、上は前へ(先頭・未選択から最後へ)", () => {
    expect(moveActive(-1, 3, "ArrowDown")).toBe(0);
    expect(moveActive(0, 3, "ArrowDown")).toBe(1);
    expect(moveActive(2, 3, "ArrowDown")).toBe(0);
    expect(moveActive(-1, 3, "ArrowUp")).toBe(2);
    expect(moveActive(0, 3, "ArrowUp")).toBe(2);
    expect(moveActive(2, 3, "ArrowUp")).toBe(1);
  });
  it("候補が無ければ -1", () => {
    expect(moveActive(0, 0, "ArrowDown")).toBe(-1);
  });
});

describe("isImeEnter", () => {
  it("変換中の Enter は決定にしない(composition の記録・isComposing・keyCode 229)", () => {
    expect(isImeEnter({ key: "Enter" }, true)).toBe(true);
    expect(isImeEnter({ key: "Enter", isComposing: true }, false)).toBe(true);
    expect(isImeEnter({ key: "Enter", keyCode: 229 }, false)).toBe(true);
    expect(isImeEnter({ key: "Enter", keyCode: 13 }, false)).toBe(false);
    expect(isImeEnter({ key: "a" }, true)).toBe(false);
  });
});

describe("表示の文字", () => {
  it("最後に使った日: 今年は月日、それ以前は年つき", () => {
    expect(lastUsedLabel("2026-10-07", "2026-10-12")).toBe("10月7日");
    expect(lastUsedLabel("2025-01-02", "2026-10-12")).toBe("2025年1月2日");
    expect(lastUsedLabel("不明", "2026-10-12")).toBe("不明");
    expect(usageLabel(3)).toBe("3回");
  });
  it("読み上げ用のまとめ", () => {
    expect(optionLabel(merchant(), "2026-10-12")).toBe("Aストア、食費、電話 03-0000-1111、最後 10月7日、3回");
    expect(optionLabel(merchant({ category: null, phone: null }), "2026-10-12")).toBe("Aストア、最後 10月7日、3回");
  });
});

describe("planAutofill(空欄にだけ入れる)", () => {
  const empty = emptyTxForm("2026-10-12");

  it("空欄には全部入れ、店名は候補の名前にそろえる。入れた欄の名前を返す", () => {
    const plan = planAutofill(empty, merchant(), cats);
    expect(plan.patch).toEqual({
      merchant: "Aストア",
      category: "食費",
      account: "カード",
      merchant_phone: "03-0000-1111",
      merchant_address: "東京都〇〇区1-2-3",
      invoice_number: "T0000000000000",
    });
    expect(plan.filled).toEqual(["カテゴリ", "支払方法", "電話番号", "住所", "事業者登録番号"]);
  });

  it("すでに入力した欄は上書きしない(空白だけの欄は空とみなす)", () => {
    const plan = planAutofill({ ...empty, category: "日用品", merchant_phone: "045-111-2222", account: "  " }, merchant(), cats);
    expect(plan.patch.category).toBeUndefined();
    expect(plan.patch.merchant_phone).toBeUndefined();
    expect(plan.patch.account).toBe("カード");
    expect(plan.filled).toEqual(["支払方法", "住所", "事業者登録番号"]);
  });

  it("候補に値が無い欄、選べる名前に無いカテゴリ・口座は入れない", () => {
    const plan = planAutofill(empty, merchant({ category: "消えたカテゴリ", account: "消えた口座", phone: null, address: " ", invoice_number: null }), cats);
    expect(plan.patch).toEqual({ merchant: "Aストア" });
    expect(plan.filled).toEqual([]);
  });

  it("通知の文", () => {
    expect(autofillNotice(["カテゴリ", "支払方法"])).toBe("前回の内容を入れました: カテゴリ、支払方法");
    expect(autofillNotice([])).toBeNull();
  });
});
