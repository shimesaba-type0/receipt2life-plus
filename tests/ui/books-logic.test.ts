import { describe, expect, it } from "vitest";
import { checkForm, countText, EMPTY_FORM, formFromBook, isbnText, newBookFrom, patchFrom } from "../../ui/src/pages/booksLogic";

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
    const before = formFromBook({ id: "b", isbn: "9784000000000", title: "ダミー", author: "著者", series: null, buyer: null, note: null, purchased_on: "2026-10-01", transaction_id: null, created_at: "x" });
    expect(patchFrom(before, before)).toEqual({});
    expect(patchFrom(before, { ...before, author: "", series: "S1" })).toEqual({ author: null, series: "S1" });
  });

  it("件数の文言と、ISBN の表示", () => {
    expect(countText(0, 0)).toBe("該当する本はありません。");
    expect(countText(3, 3)).toBe("3冊");
    expect(countText(300, 200)).toBe("300冊(新しい順に200冊を表示)");
    expect(isbnText("9784000000000")).toBe("978-400000000-0");
    expect(isbnText(null)).toBe("");
  });
});
