import { describe, expect, it } from "vitest";
import type { CategoriesData } from "../../src/api/contract";
import { categoryChipLabel } from "../../ui/src/pages/dayLogic";

const cats: CategoriesData = {
  categories: [
    { name: "チャージ", group_name: "交通", icon: null, usage: 0 },
    { name: "食費", group_name: "食費", icon: null, usage: 0 },
  ],
  accounts: [],
};

describe("categoryChipLabel", () => {
  it("大分類とカテゴリを「・」で結合して1つにする", () => {
    expect(categoryChipLabel("チャージ", cats)).toBe("交通・チャージ");
  });
  it("大分類とカテゴリが同名ならカテゴリ名だけ", () => {
    expect(categoryChipLabel("食費", cats)).toBe("食費");
  });
  it("大分類が分からなければカテゴリ名だけ", () => {
    expect(categoryChipLabel("不明", cats)).toBe("不明");
  });
  it("カテゴリ未設定なら null", () => {
    expect(categoryChipLabel(null, cats)).toBeNull();
    expect(categoryChipLabel("", cats)).toBeNull();
  });
});
