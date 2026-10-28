import { describe, expect, it } from "vitest";
import { reviewCountText, reviewReason, reviewTitle } from "../../ui/src/pages/reviewLogic";

describe("要確認の一覧の部品", () => {
  it("理由: 店名が無ければ店名、あればカテゴリ", () => {
    expect(reviewReason({ merchant: null })).toBe("店名がありません");
    expect(reviewReason({ merchant: " " })).toBe("店名がありません");
    expect(reviewReason({ merchant: "ダミー店" })).toBe("カテゴリがありません");
  });

  it("見出しと件数の文言", () => {
    expect(reviewTitle({ merchant: null })).toBe("店名なし");
    expect(reviewTitle({ merchant: "ダミー店" })).toBe("ダミー店");
    expect(reviewCountText(0)).toBe("要確認の記録はありません。");
    expect(reviewCountText(2)).toContain("2件");
  });
});
