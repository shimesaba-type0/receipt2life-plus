import { describe, expect, it } from "vitest";
import { PAGE_SIZES, statusLabel, bookHeading, pageCountOf, checkForm, coverColor, countText, EMPTY_FORM, formFromBook, isbnText, newBookFrom, patchFrom } from "../../ui/src/pages/booksLogic";

describe("本の画面の部品", () => {
  it("ISBN もタイトルも空なら、案内を返す", () => {
    expect(checkForm(EMPTY_FORM)).toContain("ISBN かタイトル");
    expect(checkForm({ ...EMPTY_FORM, title: "ダミー" })).toBeNull();
    expect(checkForm({ ...EMPTY_FORM, isbn: "9784000000000" })).toBeNull();
  });

  it("追加は、空の項目を送らない。前後の空白は取る", () => {
    expect(newBookFrom({ ...EMPTY_FORM, title: " ダミー ", author: "", purchased_on: "2026-10-01" })).toEqual({ title: "ダミー", purchased_on: "2026-10-01" });
  });

  it("直すときは、変えた項目だけ送る。空にしたら null", () => {
    const before = formFromBook({ id: "b", isbn: "9784000000000", title: "ダミー", author: "著者", series: null, buyer: null, note: null, cover_url: null, status: "owned", released_on: null, purchased_on: "2026-10-01", transaction_id: null, created_at: "x" });
    expect(patchFrom(before, before)).toEqual({});
    expect(patchFrom(before, { ...before, author: "", series: "S1" })).toEqual({ author: null, series: "S1" });
  });

  it("手放した本: 状況と手放した日を送る。手元にあるときは送らない", () => {
    expect(newBookFrom({ ...EMPTY_FORM, title: "ダミー" })).toEqual({ title: "ダミー" });
    expect(newBookFrom({ ...EMPTY_FORM, title: "ダミー", status: "sold", released_on: "2026-10-05" })).toEqual({ title: "ダミー", status: "sold", released_on: "2026-10-05" });
    const before = { ...EMPTY_FORM, title: "ダミー" };
    expect(patchFrom(before, { ...before, status: "given", released_on: "2026-10-06" })).toEqual({ status: "given", released_on: "2026-10-06" });
    const sold = { ...before, status: "sold" as const, released_on: "2026-10-05" };
    expect(patchFrom(sold, { ...sold, status: "owned", released_on: "" })).toEqual({ status: "owned" });
    expect(statusLabel("sold")).toBe("売った");
  });

  it("カバーがないときの色は、同じ題なら同じ。見出しはタイトル、なければ ISBN", () => {
    expect(coverColor("ダミー小説")).toEqual(coverColor("ダミー小説"));
    expect(coverColor("")).toBeDefined();
    expect(bookHeading({ title: "ダミー", isbn: null })).toBe("ダミー");
    expect(bookHeading({ title: null, isbn: "9784000000000" })).toBe("ISBN 978-400000000-0");
  });

  it("件数の文言と、ISBN の表示", () => {
    expect(countText(0)).toBe("該当する本はありません。");
    expect(countText(300)).toBe("300冊");
    expect(pageCountOf(0, 24)).toBe(1);
    expect(pageCountOf(24, 24)).toBe(1);
    expect(pageCountOf(25, 24)).toBe(2);
    expect(PAGE_SIZES).toHaveLength(5);
    expect(isbnText("9784000000000")).toBe("978-400000000-0");
    expect(isbnText(null)).toBe("");
  });
});
