import { describe, expect, it } from "vitest";
import { getDay } from "../../src/core/calendar";
import {
  invoiceNumberField,
  merchantPhoneField,
  normalizeInvoiceNumber,
  normalizePaidTime,
  normalizePhone,
  paidTimeField,
  phoneDigits,
} from "../../src/core/receipt-details";
import { addTransactions, dedupHash, escapeLike, getTransaction, listTransactions, updateTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

// レシートの情報(paid_time など)の core のテスト。電話・住所・番号はすべてダミー
const db = () => testEnv().DB;
const add = (transactions: unknown[]) => addTransactions(db(), { transactions }, { now: NOW });
const update = (input: unknown) => updateTransaction(db(), input, { now: NOW });

async function addOne(tx: Record<string, unknown>) {
  const res = await add([{ date: "2026-10-10", amount: 1000, merchant: "Aタクシー", category: "交通・チャージ", ...tx }]);
  if (!res.ok) throw new Error(`add failed: ${JSON.stringify(res.errors)}`);
  return res.registered[0]!;
}

const firstError = (res: { ok: boolean; errors?: { field: string; message: string }[] }) => (res.ok ? null : res.errors![0]!);

describe("正規化の純関数", () => {
  it("登録番号: 全角・小文字 t・ハイフンや空白を正規化する", () => {
    expect(normalizeInvoiceNumber("T 1234-5678-90123")).toBe("T1234567890123");
    expect(normalizeInvoiceNumber("ｔ１２３４５６７８９０１２３")).toBe("T1234567890123");
    expect(normalizeInvoiceNumber(" t1234–5678－90123 ")).toBe("T1234567890123");
  });

  it("電話番号: 全角は半角、ハイフン類は -、空白は1つ、前後は除く", () => {
    expect(normalizePhone("　０３ー００００－００００ ")).toBe("03-0000-0000");
    expect(normalizePhone("（03）0000   0000")).toBe("(03)0000 0000");
    expect(phoneDigits("+81 (3) 0000-0000")).toBe("81300000000");
  });

  it("時刻: 全角数字を半角にして前後の空白を除く", () => {
    expect(normalizePaidTime(" １４：３２ ")).toBe("14:32");
  });
});

describe("検証(Zod のスキーマ)", () => {
  it("決済時刻は 00:00〜23:59 の HH:MM だけ", () => {
    for (const ok of ["00:00", "09:05", "14:32", "23:59", "１４：３２"]) expect(paidTimeField.safeParse(ok).success, ok).toBe(true);
    for (const ng of ["24:00", "9:05", "14:60", "1432", "14:3", "", "昼", "14:32:10", "25:00"]) expect(paidTimeField.safeParse(ng).success, ng).toBe(false);
  });

  it("電話番号は数字・ハイフン・括弧・プラス・空白のみ、30文字まで", () => {
    for (const ok of ["03-0000-0000", "(03) 0000-0000", "+81 3-0000-0000", "０３−０００−００００", "0000"]) expect(merchantPhoneField.safeParse(ok).success, ok).toBe(true);
    for (const ng of ["03-0000-0000 内線12", "tel 03", "03.0000.0000", "---", "()", "", "   "]) expect(merchantPhoneField.safeParse(ng).success, ng).toBe(false);
    expect(merchantPhoneField.safeParse("0".repeat(30)).success).toBe(true);
    expect(merchantPhoneField.safeParse("0".repeat(31)).success).toBe(false);
  });

  it("登録番号は正規化後に T + 13桁でなければ、日本語のエラー", () => {
    for (const ok of ["T0000000000000", "t0000000000000", "T 0000-0000-00000", "Ｔ０００００００００００００"]) expect(invoiceNumberField.safeParse(ok).success, ok).toBe(true);
    for (const ng of ["0000000000000", "T000000000000", "T00000000000000", "TA000000000000", "T", "", "X0000000000000"]) {
      const r = invoiceNumberField.safeParse(ng);
      expect(r.success, ng).toBe(false);
      if (!r.success) expect(r.error.issues[0]!.message).toBe("T と数字13桁で入力してください(例: T0000000000000)");
    }
  });
});

describe("add_transactions", () => {
  it("6項目を保存し、正規化して返す。list・getTransaction・day にも含まれる", async () => {
    const tx = await addOne({
      paid_time: "14:32",
      merchant_phone: "０３−００００−００００",
      merchant_address: "  東京都〇〇区〇〇1-2-3  ",
      invoice_number: "T 0000-0000-00000",
      clerk_name: " 担当 山田 ",
      receipt_no: " 0001-23 ",
    });
    const expected = {
      paid_time: "14:32",
      merchant_phone: "03-0000-0000",
      merchant_address: "東京都〇〇区〇〇1-2-3",
      invoice_number: "T0000000000000",
      clerk_name: "担当 山田",
      receipt_no: "0001-23",
    };
    expect(tx).toMatchObject(expected);

    const list = await listTransactions(db(), {});
    expect(list.ok && list.transactions[0]).toMatchObject(expected);
    const detail = await getTransaction(db(), tx.id);
    expect(detail.ok && detail.transaction).toMatchObject(expected);
    const day = await getDay(db(), "2026-10-10");
    expect(day.ok && day.transactions[0]).toMatchObject(expected);
  });

  it("省略・null は null で保存(既存どおりの登録もそのまま通る)", async () => {
    const plain = await addOne({});
    expect(plain).toMatchObject({ paid_time: null, merchant_phone: null, merchant_address: null, invoice_number: null, clerk_name: null, receipt_no: null });
    const withNull = await addOne({ amount: 1001, paid_time: null, invoice_number: null });
    expect(withNull.paid_time).toBeNull();
  });

  it("不正な値は項目名つきの日本語エラーで、全体を拒否する", async () => {
    const res = await add([
      { amount: 500, merchant: "Bマート" },
      { amount: 1000, invoice_number: "T123", paid_time: "25:00", merchant_phone: "abc", merchant_address: "あ".repeat(201), clerk_name: "い".repeat(51), receipt_no: "う".repeat(51) },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => [e.index, e.field])).toEqual(expect.arrayContaining([[1, "invoice_number"], [1, "paid_time"], [1, "merchant_phone"], [1, "merchant_address"], [1, "clerk_name"], [1, "receipt_no"]]));
    expect(res.errors.find((e) => e.field === "invoice_number")!.message).toContain("T と数字13桁で入力してください");
    const total = await db().prepare("SELECT COUNT(*) AS n FROM transactions").first<{ n: number }>();
    expect(total!.n).toBe(0);
  });

  it("上限ちょうど(住所200・担当50・レシート番号50)は通る", async () => {
    const tx = await addOne({ merchant_address: "あ".repeat(200), clerk_name: "い".repeat(50), receipt_no: "う".repeat(50) });
    expect(tx.merchant_address).toHaveLength(200);
  });
});

describe("dedup_hash と重複判定", () => {
  it("時刻なしは従来どおり(日付|金額|店名)。時刻ありはハッシュが変わる", async () => {
    const before = await dedupHash("2026-10-10", 1000, "Aタクシー");
    expect(await dedupHash("2026-10-10", 1000, "Aタクシー", null)).toBe(before);
    expect(await dedupHash("2026-10-10", 1000, "Aタクシー", undefined)).toBe(before);
    const t1 = await dedupHash("2026-10-10", 1000, "Aタクシー", "14:32");
    const t2 = await dedupHash("2026-10-10", 1000, "Aタクシー", "18:05");
    expect(new Set([before, t1, t2]).size).toBe(3);
    // 既存の計算式(固定の文字列のSHA-256)と同じ
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("2026-10-10|1000|aタクシー"));
    expect(before).toBe([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  });

  it("同じ日・同じ店・同額でも、時刻が違えば別の買い物として登録される", async () => {
    await addOne({ paid_time: "08:10" });
    const res = await add([{ date: "2026-10-10", amount: 1000, merchant: "Aタクシー", paid_time: "18:05" }]);
    expect(res.ok && res.registered).toHaveLength(1);
    expect(res.ok && res.skipped_duplicates).toHaveLength(0);
  });

  it("同じ時刻なら重複としてスキップ(同じ呼び出しの中でも)", async () => {
    await addOne({ paid_time: "08:10" });
    const dup = await add([{ date: "2026-10-10", amount: 1000, merchant: "Aタクシー", paid_time: "08:10" }]);
    expect(dup.ok && dup.skipped_duplicates).toHaveLength(1);
    const batch = await add([
      { date: "2026-10-09", amount: 700, merchant: "Bタクシー", paid_time: "09:00" },
      { date: "2026-10-09", amount: 700, merchant: "Bタクシー", paid_time: "09:00" },
      { date: "2026-10-09", amount: 700, merchant: "Bタクシー", paid_time: "09:01" },
    ]);
    expect(batch.ok && batch.registered).toHaveLength(2);
    expect(batch.ok && batch.skipped_duplicates).toEqual([{ index: 1, duplicate_of_index: 0 }]);
  });

  it("時刻なしの取引は従来どおり重複扱い(既存の行のハッシュは変わらない)", async () => {
    await addOne({});
    const dup = await add([{ date: "2026-10-10", amount: 1000, merchant: "Aタクシー" }]);
    expect(dup.ok && dup.skipped_duplicates).toHaveLength(1);
  });
});

describe("update_transaction", () => {
  it("項目だけの更新が成立し、null で空にでき、渡さない項目は変わらない", async () => {
    const tx = await addOne({ paid_time: "14:32", merchant_phone: "03-0000-0000", clerk_name: "山田" });
    const r1 = await update({ id: tx.id, merchant_address: "東京都〇〇区〇〇1-2-3", invoice_number: "t 0000-0000-00000", receipt_no: "A-1" });
    expect(r1.ok && r1.transaction).toMatchObject({
      paid_time: "14:32",
      merchant_phone: "03-0000-0000",
      clerk_name: "山田",
      merchant_address: "東京都〇〇区〇〇1-2-3",
      invoice_number: "T0000000000000",
      receipt_no: "A-1",
    });
    const r2 = await update({ id: tx.id, merchant_phone: null, paid_time: null, clerk_name: null });
    expect(r2.ok && r2.transaction).toMatchObject({ merchant_phone: null, paid_time: null, clerk_name: null, merchant_address: "東京都〇〇区〇〇1-2-3" });
    const detail = await getTransaction(db(), tx.id);
    expect(detail.ok && detail.transaction.receipt_no).toBe("A-1");
  });

  it("不正な値は項目名つきでエラー、保存されない", async () => {
    const tx = await addOne({ paid_time: "14:32" });
    const bad = await update({ id: tx.id, invoice_number: "T12", paid_time: "99:99" });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.map((e) => e.field).sort()).toEqual(["invoice_number", "paid_time"]);
    const empty = await update({ id: tx.id, merchant_phone: "" });
    expect(firstError(empty)?.field).toBe("merchant_phone");
    const detail = await getTransaction(db(), tx.id);
    expect(detail.ok && detail.transaction.paid_time).toBe("14:32");
  });

  it("paid_time を足すと dedup_hash が変わり、外すと元に戻る", async () => {
    const tx = await addOne({});
    const hashOf = async () => (await db().prepare("SELECT dedup_hash FROM transactions WHERE id = ?").bind(tx.id).first<{ dedup_hash: string }>())!.dedup_hash;
    const h0 = await hashOf();
    await update({ id: tx.id, paid_time: "14:32" });
    const h1 = await hashOf();
    expect(h1).not.toBe(h0);
    expect(h1).toBe(await dedupHash("2026-10-10", 1000, "Aタクシー", "14:32"));
    await update({ id: tx.id, paid_time: null });
    expect(await hashOf()).toBe(h0);
  });

  it("変更する項目が何も無い更新は、今までどおりエラー", async () => {
    const tx = await addOne({});
    const res = await update({ id: tx.id });
    expect(res.ok).toBe(false);
  });
});

describe("list_transactions の keyword", () => {
  async function seed() {
    await add([
      { date: "2026-10-01", amount: 1000, merchant: "Aタクシー", paid_time: "08:10", merchant_phone: "03-0000-0000", merchant_address: "東京都〇〇区〇〇1-2-3", clerk_name: "山田", receipt_no: "R-100", memo: "空港まで" },
      { date: "2026-10-02", amount: 2000, merchant: "Bストア", merchant_phone: "(045) 111-2222", memo: "100%ジュース" },
      { date: "2026-10-03", amount: 3000, merchant: "C_shop", memo: "ふつう" },
      { date: "2026-10-04", amount: 4000, merchant: "Dカフェ", invoice_number: "T0000000000001" },
    ]);
  }
  const names = async (input: Record<string, unknown>) => {
    const r = await listTransactions(db(), input);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.transactions.map((t) => t.merchant).sort();
  };

  it("店名・電話番号・住所・担当者名・メモ・レシート番号のどれかに部分一致する", async () => {
    await seed();
    expect(await names({ keyword: "タクシー" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "03-0000" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "〇〇区" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "山田" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "空港" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "r-100" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "T0000000000001" })).toEqual(["Dカフェ"]);
    expect(await names({ keyword: "存在しない語" })).toEqual([]);
  });

  it("電話番号は数字だけ・括弧やハイフンの違いでも当たる", async () => {
    await seed();
    expect(await names({ keyword: "0300000000" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "０３００００" })).toEqual(["Aタクシー"]);
    expect(await names({ keyword: "045111" })).toEqual(["Bストア"]);
    expect(await names({ keyword: "(045)" })).toEqual(["Bストア"]);
    expect(await names({ keyword: "045 111-2222" })).toEqual(["Bストア"]);
  });

  it("LIKE のワイルドカード % と _ はエスケープされ、文字そのものとして探す", async () => {
    await seed();
    expect(await names({ keyword: "%" })).toEqual(["Bストア"]);
    expect(await names({ keyword: "_" })).toEqual(["C_shop"]);
    expect(await names({ keyword: "100%ジュ" })).toEqual(["Bストア"]);
    // エスケープしなければ全件に当たる文字列
    expect(await names({ keyword: "%%" })).toEqual([]);
    expect(await names({ keyword: "A_クシー" })).toEqual([]);
    expect(await names({ keyword: "\\" })).toEqual([]);
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  it("ほかの条件と組み合わせられる。空文字・長すぎるキーワードはエラー", async () => {
    await seed();
    expect(await names({ keyword: "タクシー", from: "2026-10-02" })).toEqual([]);
    expect(await names({ keyword: "タクシー", from: "2026-10-01", to: "2026-10-01", category: "交通・チャージ" })).toEqual([]);
    const empty = await listTransactions(db(), { keyword: "  " });
    expect(!empty.ok && empty.errors[0]!.field).toBe("keyword");
    const long = await listTransactions(db(), { keyword: "あ".repeat(101) });
    expect(long.ok).toBe(false);
  });

  it("SQLインジェクション風の文字列も、ただの文字列として探す", async () => {
    await seed();
    expect(await names({ keyword: "'; DROP TABLE transactions; --" })).toEqual([]);
    expect(await names({ keyword: "" + "タクシー" })).toEqual(["Aタクシー"]);
  });
});

describe("day の並び順", () => {
  it("決済時刻の昇順。時刻なしは末尾で、その中は登録順", async () => {
    const created = async (iso: string, tx: Record<string, unknown>) => {
      const res = await addTransactions(db(), { transactions: [{ date: "2026-10-10", ...tx }] }, { now: new Date(iso) });
      if (!res.ok) throw new Error(JSON.stringify(res.errors));
      return res.registered[0]!.merchant;
    };
    // 登録順: 夕方 → 時刻なし1 → 朝 → 時刻なし2 → 昼
    await created("2026-10-10T01:00:00Z", { amount: 100, merchant: "夕方", paid_time: "18:05" });
    await created("2026-10-10T01:01:00Z", { amount: 200, merchant: "時刻なし1" });
    await created("2026-10-10T01:02:00Z", { amount: 300, merchant: "朝", paid_time: "08:10" });
    await created("2026-10-10T01:03:00Z", { amount: 400, merchant: "時刻なし2" });
    await created("2026-10-10T01:04:00Z", { amount: 500, merchant: "昼", paid_time: "12:00" });
    await created("2026-10-10T01:05:00Z", { amount: 600, merchant: "深夜", paid_time: "00:30" });
    const day = await getDay(db(), "2026-10-10");
    expect(day.ok && day.transactions.map((t) => t.merchant)).toEqual(["深夜", "朝", "昼", "夕方", "時刻なし1", "時刻なし2"]);
  });

  it("同じ時刻どうしは登録順", async () => {
    await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 100, merchant: "先", paid_time: "10:00" }] }, { now: new Date("2026-10-10T01:00:00Z") });
    await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 200, merchant: "後", paid_time: "10:00" }] }, { now: new Date("2026-10-10T01:01:00Z") });
    const day = await getDay(db(), "2026-10-10");
    expect(day.ok && day.transactions.map((t) => t.merchant)).toEqual(["先", "後"]);
  });
});
