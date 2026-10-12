import { describe, expect, it } from "vitest";
import { foldText, listMerchants, phoneQueryDigits } from "../../src/core/merchants";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// 店名の候補。店名・電話・住所はすべてダミー
const db = () => testEnv().DB;

async function seed(rows: Record<string, unknown>[]) {
  const res = await addTransactions(db(), { transactions: rows.map((r, i) => ({ amount: 100 + i, allow_duplicate: true, ...r })) }, { now: NOW });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
}

const list = async (input: unknown = {}) => {
  const res = await listMerchants(db(), input);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.merchants;
};
const names = async (input: unknown = {}) => (await list(input)).map((m) => m.merchant);

describe("純関数", () => {
  it("foldText: 全角半角・大文字小文字・空白・カタカナ/ひらがなを吸収する", () => {
    expect(foldText(" Ａ ストア ")).toBe("aすとあ");
    expect(foldText("セブン")).toBe(foldText("せぶん"));
    expect(foldText(null)).toBe("");
  });

  it("phoneQueryDigits: 電話番号らしい入力だけ数字にする", () => {
    expect(phoneQueryDigits("03-12")).toBe("0312");
    expect(phoneQueryDigits("（０３）")).toBe("03");
    expect(phoneQueryDigits("A店")).toBe("");
    expect(phoneQueryDigits("03 abc")).toBe("");
  });
});

describe("listMerchants", () => {
  it("店名ごとにまとめ、件数・最後の日・カテゴリ・口座・連絡先を返す。NULL・空の店名は除く", async () => {
    await seed([
      { date: "2026-10-01", merchant: "Aストア", category: "食費", account: "現金" },
      { date: "2026-10-05", merchant: "Aストア", category: "食費", account: "カード", merchant_phone: "03-1111-2222" },
      { date: "2026-10-07", merchant: "Aストア", category: "日用品", account: "カード" },
      { date: "2026-10-08" },
      { date: "2026-10-09", merchant: "x" },
    ]);
    // 画面や AI からは空の店名は入らないが、念のため DB に直接空白だけの店名があっても除く
    await db().exec("UPDATE transactions SET merchant = '  ' WHERE date = '2026-10-09'");
    const m = await list();
    expect(m).toEqual([
      {
        merchant: "Aストア",
        count: 3,
        last_date: "2026-10-07",
        category: "食費",
        account: "カード",
        phone: "03-1111-2222",
        address: null,
        invoice_number: null,
      },
    ]);
  });

  it("連絡先は項目ごとに、値のある最新の取引から。表記ゆれ(全角半角・大文字小文字)は同じ店にまとめ、表記は最新のもの", async () => {
    await seed([
      { date: "2026-09-01", merchant: "ｂマート", merchant_phone: "03-0000-0001", merchant_address: "東京都〇〇区1-1", invoice_number: "T0000000000001" },
      { date: "2026-10-01", merchant: "Bマート", merchant_phone: "03-0000-0002" },
      { date: "2026-10-02", merchant: "Bマート" },
    ]);
    const m = await list();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ merchant: "Bマート", count: 3, last_date: "2026-10-02", phone: "03-0000-0002", address: "東京都〇〇区1-1", invoice_number: "T0000000000001" });
  });

  it("店名の部分一致(大文字小文字・全角半角・かなを区別しない)", async () => {
    await seed([
      { date: "2026-10-01", merchant: "Starbucks 渋谷" },
      { date: "2026-10-02", merchant: "セブンイレブン" },
      { date: "2026-10-03", merchant: "ドトール" },
    ]);
    expect(await names({ q: "STAR" })).toEqual(["Starbucks 渋谷"]);
    expect(await names({ q: "ｓｔａｒ" })).toEqual(["Starbucks 渋谷"]);
    expect(await names({ q: "star bucks" })).toEqual(["Starbucks 渋谷"]);
    expect(await names({ q: "せぶん" })).toEqual(["セブンイレブン"]);
    expect(await names({ q: "ぶんい" })).toEqual(["セブンイレブン"]);
    expect(await names({ q: "存在しない" })).toEqual([]);
  });

  it("電話番号: ハイフン・括弧の有無を無視し、一部でも当たる。数字以外が混じる入力は電話としては比べない", async () => {
    await seed([
      { date: "2026-10-01", merchant: "A店", merchant_phone: "03-1234-5678" },
      { date: "2026-10-02", merchant: "B店", merchant_phone: "(045) 999 0000" },
      { date: "2026-10-03", merchant: "C店" },
    ]);
    expect(await names({ q: "0312345678" })).toEqual(["A店"]);
    expect(await names({ q: "03-1234" })).toEqual(["A店"]);
    expect(await names({ q: "５６７" })).toEqual(["A店"]);
    expect(await names({ q: "045-999" })).toEqual(["B店"]);
    expect(await names({ q: "0000" })).toEqual(["B店"]);
    expect(await names({ q: "03 abc" })).toEqual([]);
  });

  it("住所・カテゴリ名でも絞れる", async () => {
    await seed([
      { date: "2026-10-01", merchant: "A店", category: "食費", merchant_address: "東京都新宿区1-2-3" },
      { date: "2026-10-02", merchant: "B店", category: "日用品", merchant_address: "大阪府大阪市4-5-6" },
      { date: "2026-10-03", merchant: "C店", category: "交通・チャージ" },
    ]);
    expect(await names({ q: "新宿" })).toEqual(["A店"]);
    expect(await names({ q: "大阪市" })).toEqual(["B店"]);
    expect(await names({ q: "日用" })).toEqual(["B店"]);
    expect(await names({ q: "交通" })).toEqual(["C店"]);
    // category は完全一致で、その店のいちばん多いカテゴリ
    expect(await names({ category: "食費" })).toEqual(["A店"]);
    expect(await names({ category: "食", q: "" })).toEqual([]);
    expect(await names({ category: "日用品", q: "店" })).toEqual(["B店"]);
  });

  it("並び: 前方一致 → 件数の多い順 → 最後に使った日の新しい順", async () => {
    await seed([
      // 「カフェ」を含む店。件数: 後ろに含む店が3件、前方一致が1件
      { date: "2026-10-01", merchant: "町のカフェ" },
      { date: "2026-10-02", merchant: "町のカフェ" },
      { date: "2026-10-03", merchant: "町のカフェ" },
      { date: "2026-10-04", merchant: "カフェ・ルナ" },
      { date: "2026-10-05", merchant: "カフェ・アルファ" },
      { date: "2026-10-06", merchant: "カフェ・アルファ" },
      { date: "2026-10-09", merchant: "カフェ・ベータ" },
      { date: "2026-10-10", merchant: "カフェ・ベータ" },
    ]);
    expect(await names({ q: "カフェ" })).toEqual(["カフェ・ベータ", "カフェ・アルファ", "カフェ・ルナ", "町のカフェ"]);
    // q が空なら、よく使う順(件数 → 新しい日)
    expect(await names()).toEqual(["町のカフェ", "カフェ・ベータ", "カフェ・アルファ", "カフェ・ルナ"]);
  });

  it("limit: 既定8、最大20。範囲外・整数でなければエラー", async () => {
    await seed(Array.from({ length: 25 }, (_, i) => ({ date: "2026-10-01", merchant: `店${String(i).padStart(2, "0")}` })));
    expect(await list()).toHaveLength(8);
    expect(await list({ limit: 3 })).toHaveLength(3);
    expect(await list({ limit: 20 })).toHaveLength(20);
    for (const bad of [0, 21, 1.5, "5"]) {
      const res = await listMerchants(db(), { limit: bad });
      expect(res.ok, String(bad)).toBe(false);
      expect(res.ok ? "" : res.errors[0]!.field).toBe("limit");
    }
  });

  it("LIKE のワイルドカード(% と _ と \\)は文字として扱う", async () => {
    await seed([
      { date: "2026-10-01", merchant: "100%ジュース" },
      { date: "2026-10-02", merchant: "A_B商店" },
      { date: "2026-10-03", merchant: "普通の店" },
    ]);
    expect(await names({ q: "%" })).toEqual(["100%ジュース"]);
    expect(await names({ q: "_" })).toEqual(["A_B商店"]);
    expect(await names({ q: "\\" })).toEqual([]);
    expect(await names({ q: "a_b" })).toEqual(["A_B商店"]);
  });

  it("q は前後の空白を除く。空白だけは空と同じ。長すぎるとエラー。未知の項目もエラー", async () => {
    await seed([{ date: "2026-10-01", merchant: "A店" }, { date: "2026-10-02", merchant: "B店" }]);
    expect(await names({ q: "  A店  " })).toEqual(["A店"]);
    expect(await list({ q: "   " })).toHaveLength(2);
    expect((await listMerchants(db(), { q: "a".repeat(101) })).ok).toBe(false);
    expect((await listMerchants(db(), { foo: 1 })).ok).toBe(false);
  });
});
