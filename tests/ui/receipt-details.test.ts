import { describe, expect, it } from "vitest";
import type { TransactionView } from "../../src/api/contract";
import {
  invoiceNumberField,
  MAX_REGISTER_NO,
  MAX_STORE_CODE,
  merchantPhoneField,
  registerNoField,
  storeCodeField,
  normalizeInvoiceNumber as coreInvoice,
  normalizePaidTime as coreTime,
  normalizePhone as corePhone,
  paidTimeField,
} from "../../src/core/receipt-details";
import { buildDetails, buildPatch, emptyTxForm, txFormFromView } from "../../ui/src/pages/transactionLogic";
import { copyMessage, copyOrSelect } from "../../ui/src/clipboard";
import {
  clockLabel,
  hasShopInfo,
  invoiceHint,
  MAX_REGISTER_NO as UI_MAX_REGISTER_NO,
  MAX_STORE_CODE as UI_MAX_STORE_CODE,
  normalizeInvoiceNumber,
  normalizePaidTime,
  normalizePhone,
  parseInvoiceNumber,
  parsePaidTime,
  parsePhone,
  parseText,
  telHref,
} from "../../ui/src/receiptDetails";

// 画面側の純関数。電話・住所・番号はダミー

const INVOICE_SAMPLES = [
  "T0000000000000",
  "t0000000000000",
  "T 1234-5678-90123",
  " Ｔ１２３４－５６７８－９０１２３ ",
  "t1234–5678—90123",
  "T123",
  "0000000000000",
  "T00000000000000",
  "TＡ000000000000",
  "",
  "   ",
  "T\t0000\n0000 00000",
];
const PHONE_SAMPLES = ["03-0000-0000", "０３ー００００－００００", "(03) 0000 0000", "+81 3-0000-0000", "03-0000-0000 内線1", "abc", "---", "", "  ", "0".repeat(31), "０".repeat(30)];
const TIME_SAMPLES = ["14:32", "９:05", "09:05", "24:00", "23:59", "00:00", "14:60", "１４：３２", " 14:32 ", "1432", ""];

describe("サーバー(core)と同じ規則", () => {
  it("正規化の結果が同じ", () => {
    for (const s of INVOICE_SAMPLES) expect(normalizeInvoiceNumber(s), s).toBe(coreInvoice(s));
    for (const s of PHONE_SAMPLES) expect(normalizePhone(s), s).toBe(corePhone(s));
    for (const s of TIME_SAMPLES) expect(normalizePaidTime(s), s).toBe(coreTime(s));
  });

  it("検証の合否が同じ(空欄は画面では null = 値なし)", () => {
    for (const s of INVOICE_SAMPLES.filter((x) => x.trim() !== "")) {
      expect(parseInvoiceNumber(s).ok, s).toBe(invoiceNumberField.safeParse(s).success);
    }
    for (const s of PHONE_SAMPLES.filter((x) => x.trim() !== "")) {
      expect(parsePhone(s).ok, s).toBe(merchantPhoneField.safeParse(s).success);
    }
    for (const s of TIME_SAMPLES.filter((x) => x.trim() !== "")) {
      expect(parsePaidTime(s).ok, s).toBe(paidTimeField.safeParse(s).success);
    }
  });

  it("正規化した値も同じ", () => {
    for (const s of INVOICE_SAMPLES) {
      const ui = parseInvoiceNumber(s);
      const core = invoiceNumberField.safeParse(s);
      if (ui.ok && core.success && ui.value !== null) expect(ui.value).toBe(core.data);
    }
    expect(parsePhone("０３ー００００－００００")).toEqual({ ok: true, value: "03-0000-0000" });
  });
});

describe("登録番号の検証", () => {
  it("全角・小文字・ハイフンや空白入りを T + 13桁に正規化する", () => {
    expect(parseInvoiceNumber("T 1234-5678-90123")).toEqual({ ok: true, value: "T1234567890123" });
    expect(parseInvoiceNumber("ｔ０００００００００００００")).toEqual({ ok: true, value: "T0000000000000" });
  });
  it("空欄は値なし(null)、足りない・多い・T が無いは日本語のエラー", () => {
    expect(parseInvoiceNumber("  ")).toEqual({ ok: true, value: null });
    for (const bad of ["T123", "T00000000000000", "0000000000000", "X0000000000000"]) {
      expect(parseInvoiceNumber(bad)).toEqual({ ok: false, error: "事業者登録番号は T と数字13桁で入力してください。" });
    }
  });
  it("入力中の注意書き: 空欄・正しい値は無し", () => {
    expect(invoiceHint("")).toBeNull();
    expect(invoiceHint("t 0000-0000-00000")).toBeNull();
    expect(invoiceHint("T12")).toContain("T と数字13桁");
  });
});

describe("その他の項目の検証", () => {
  it("時刻は 00:00〜23:59 の HH:MM", () => {
    expect(parsePaidTime("")).toEqual({ ok: true, value: null });
    expect(parsePaidTime("14:32")).toEqual({ ok: true, value: "14:32" });
    expect(parsePaidTime("24:00").ok).toBe(false);
    expect(parsePaidTime("9:05").ok).toBe(false);
  });
  it("電話は文字種と30文字", () => {
    expect(parsePhone("(03) 0000-0000")).toEqual({ ok: true, value: "(03) 0000-0000" });
    expect(parsePhone("03.0000.0000").ok).toBe(false);
    expect(parsePhone("0".repeat(31)).ok).toBe(false);
  });
  it("文字数の上限", () => {
    expect(parseText("あ".repeat(200), 200, "住所").ok).toBe(true);
    expect(parseText("あ".repeat(201), 200, "住所")).toEqual({ ok: false, error: "住所は200文字以内にしてください。" });
    expect(parseText("  ", 50, "x")).toEqual({ ok: true, value: null });
  });
});

describe("buildDetails / buildPatch", () => {
  it("入力欄を正規化して API の入力にする。空欄は null(空にする)", () => {
    const form = {
      ...emptyTxForm("2026-10-11"),
      invoice_number: "t 0000-0000-00000",
      merchant_phone: "０３−００００−００００",
      paid_time: "14:32",
      merchant_address: " 東京都〇〇区〇〇1-2-3 ",
    };
    expect(buildDetails(form)).toEqual({
      ok: true,
      value: { paid_time: "14:32", merchant_phone: "03-0000-0000", merchant_address: "東京都〇〇区〇〇1-2-3", invoice_number: "T0000000000000", receipt_no: null, register_no: null, store_code: null },
    });
  });
  it("不正な値は、保存せずエラーの文を返す", () => {
    const base = { ...emptyTxForm("2026-10-11"), amount: "100" };
    expect(buildPatch({ ...base, invoice_number: "T12" }, [], false)).toEqual({ ok: false, error: "事業者登録番号は T と数字13桁で入力してください。" });
    expect(buildPatch({ ...base, paid_time: "25:00" }, [], false)).toMatchObject({ ok: false });
    expect(buildPatch({ ...base, merchant_phone: "abc" }, [], false)).toMatchObject({ ok: false });
  });
  it("PATCH に8項目が含まれる(全部空でも null を送り、画面で消した値が空になる)", () => {
    const r = buildPatch({ ...emptyTxForm("2026-10-11"), amount: "100" }, [], false);
    expect(r.ok && r.value).toMatchObject({ paid_time: null, merchant_phone: null, merchant_address: null, invoice_number: null, receipt_no: null, register_no: null, store_code: null });
  });
  it("取引からフォームの文字列にする", () => {
    const tx: TransactionView = {
      id: "t",
      date: "2026-10-11",
      amount: 100,
      merchant: null,
      category: null,
      account: null,
      memo: null,
      source: "manual",
      status: "ok",
      tax_flag: null,
      paid_time: "09:05",
      merchant_phone: "03-0000-0000",
      merchant_address: null,
      invoice_number: "T0000000000000",
      receipt_no: "A-1",
      register_no: "0005",
      store_code: "007832",
      items: [],
      tax_lines: [],
    };
    expect(txFormFromView(tx)).toMatchObject({ paid_time: "09:05", merchant_phone: "03-0000-0000", merchant_address: "", invoice_number: "T0000000000000", receipt_no: "A-1", register_no: "0005", store_code: "007832" });
  });
});

describe("表示", () => {
  const none = { merchant_phone: null, merchant_address: null, invoice_number: null, receipt_no: null, register_no: null, store_code: null };
  it("店舗の情報: 7項目が全部空ならブロックを出さない", () => {
    expect(hasShopInfo(none)).toBe(false);
    expect(hasShopInfo({ ...none, merchant_phone: "  " })).toBe(false);
    for (const k of Object.keys(none) as (keyof typeof none)[]) expect(hasShopInfo({ ...none, [k]: "x" }), k).toBe(true);
  });
  it("tel: リンクは数字と先頭の + だけ", () => {
    expect(telHref("03-0000-0000")).toBe("tel:0300000000");
    expect(telHref("(03) 0000-0000")).toBe("tel:0300000000");
    expect(telHref("+81 3-0000-0000")).toBe("tel:+81300000000");
    expect(telHref("０３−００００−００００")).toBe("tel:0300000000");
    expect(telHref("--")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("")).toBeNull();
  });
  it("日の行の時刻", () => {
    expect(clockLabel("14:32")).toBe("14:32");
    expect(clockLabel(null)).toBeNull();
    expect(clockLabel("")).toBeNull();
    expect(clockLabel("99:99")).toBeNull();
  });
});

describe("コピーのボタン", () => {
  it("クリップボードが使えれば書き込む", async () => {
    const written: string[] = [];
    let selected = 0;
    const outcome = await copyOrSelect("T0000000000000", { writeText: async (t) => void written.push(t) }, () => void (selected += 1));
    expect(outcome).toBe("copied");
    expect(written).toEqual(["T0000000000000"]);
    expect(selected).toBe(0);
  });
  it("クリップボードが無い・失敗したときは、テキストを選択状態にする", async () => {
    let selected = 0;
    expect(await copyOrSelect("x", undefined, () => void (selected += 1))).toBe("selected");
    expect(await copyOrSelect("x", { writeText: () => Promise.reject(new Error("denied")) }, () => void (selected += 1))).toBe("selected");
    expect(selected).toBe(2);
  });
  it("メッセージ", () => {
    expect(copyMessage("copied", "住所")).toBe("住所をコピーしました");
    expect(copyMessage("selected", "住所")).toContain("選択しました");
  });
});

describe("レジ番号・店番号", () => {
  it("サーバー(core)と同じ上限(30文字)・前後の空白を除く・空欄は値なし", () => {
    expect(UI_MAX_REGISTER_NO).toBe(MAX_REGISTER_NO);
    expect(UI_MAX_STORE_CODE).toBe(MAX_STORE_CODE);
    for (const [raw, ok] of [["0005", true], [" 007832 ", true], ["1".repeat(30), true], ["1".repeat(31), false]] as const) {
      expect(parseText(raw, UI_MAX_REGISTER_NO, "レジ番号").ok, raw).toBe(ok);
      expect(registerNoField.safeParse(raw).success, raw).toBe(ok);
      expect(storeCodeField.safeParse(raw).success, raw).toBe(ok);
    }
    expect(parseText("  ", UI_MAX_STORE_CODE, "店番号")).toEqual({ ok: true, value: null });
    expect(parseText(" 0005 ", UI_MAX_REGISTER_NO, "レジ番号")).toEqual({ ok: true, value: "0005" });
  });

  it("buildDetails: 入力を前後の空白なしで API の入力にする。長すぎるとエラーの文", () => {
    const form = { ...emptyTxForm("2026-10-11"), amount: "100", register_no: " 0005 ", store_code: "007832", receipt_no: "P20261003152814" };
    const r = buildDetails(form);
    expect(r.ok && r.value).toMatchObject({ register_no: "0005", store_code: "007832", receipt_no: "P20261003152814" });
    expect(buildPatch({ ...form, register_no: "1".repeat(31) }, [], false)).toEqual({ ok: false, error: "レジ番号は30文字以内にしてください。" });
    expect(buildPatch({ ...form, store_code: "1".repeat(31) }, [], false)).toEqual({ ok: false, error: "店番号は30文字以内にしてください。" });
  });

  it("店舗の情報のブロックは、レジ番号・店番号だけでも出す", () => {
    const none = { merchant_phone: null, merchant_address: null, invoice_number: null, receipt_no: null, register_no: null, store_code: null };
    expect(hasShopInfo({ ...none, register_no: "0005" })).toBe(true);
    expect(hasShopInfo({ ...none, store_code: "007832" })).toBe(true);
  });
});
