import { describe, expect, it } from "vitest";
import type { CategoryView } from "../../src/api/contract";
import {
  MAX_CATEGORY_NAME,
  MAX_GROUP_NAME,
  buildCategoryPatch,
  canDeleteAny,
  checkGroupRename,
  checkNewCategory,
  defaultMoveTarget,
  errorText,
  groupCategories,
  moveTargets,
  usageLabel,
  validateName,
} from "../../ui/src/pages/categoriesLogic";

const cat = (name: string, group_name: string, usage = 0): CategoryView => ({ name, group_name, icon: null, usage });
const sample = [cat("食費", "食費", 3), cat("日用品", "生活", 1), cat("外食", "食費"), cat("光熱費", "住まい")];

describe("groupCategories", () => {
  it("大分類ごとにまとめる(大分類は最初に現れた順、中は元の順)", () => {
    expect(groupCategories(sample)).toEqual([
      { group_name: "食費", categories: [{ name: "食費", icon: null, usage: 3 }, { name: "外食", icon: null, usage: 0 }] },
      { group_name: "生活", categories: [{ name: "日用品", icon: null, usage: 1 }] },
      { group_name: "住まい", categories: [{ name: "光熱費", icon: null, usage: 0 }] },
    ]);
  });
  it("空なら空", () => {
    expect(groupCategories([])).toEqual([]);
  });
});

describe("validateName", () => {
  it("前後の空白を取り除く", () => {
    expect(validateName("  外食 ", "名前", MAX_CATEGORY_NAME)).toEqual({ ok: true, value: "外食" });
  });
  it("空・空白だけはエラー", () => {
    expect(validateName("", "名前", 30)).toEqual({ ok: false, error: "名前を入力してください" });
    expect(validateName("　 ", "名前", 30)).toMatchObject({ ok: false });
  });
  it("上限ちょうどは通り、超えるとエラー", () => {
    expect(validateName("あ".repeat(MAX_GROUP_NAME), "大分類名", MAX_GROUP_NAME).ok).toBe(true);
    expect(validateName("あ".repeat(MAX_GROUP_NAME + 1), "大分類名", MAX_GROUP_NAME)).toEqual({ ok: false, error: "大分類名は20文字以内にしてください" });
  });
  it("ドットだけの名前はエラー(URLにできない)", () => {
    expect(validateName("..", "名前", 30).ok).toBe(false);
  });
});

describe("checkNewCategory", () => {
  it("名前を検査し、重複を断る", () => {
    expect(checkNewCategory(sample, " 趣味 ")).toEqual({ ok: true, value: "趣味" });
    expect(checkNewCategory(sample, "外食")).toEqual({ ok: false, error: "「外食」というカテゴリは既にあります" });
    expect(checkNewCategory(sample, "")).toMatchObject({ ok: false });
  });
});

describe("buildCategoryPatch", () => {
  const current = { name: "外食", group_name: "食費" };
  it("変えた項目だけを送る", () => {
    expect(buildCategoryPatch(sample, current, { name: "外食・飲み会", group: "食費" })).toEqual({ ok: true, patch: { new_name: "外食・飲み会" } });
    expect(buildCategoryPatch(sample, current, { name: "外食", group: "生活" })).toEqual({ ok: true, patch: { group_name: "生活" } });
    expect(buildCategoryPatch(sample, current, { name: "ランチ", group: "住まい" })).toEqual({ ok: true, patch: { new_name: "ランチ", group_name: "住まい" } });
  });
  it("何も変わっていなければエラー", () => {
    expect(buildCategoryPatch(sample, current, { name: " 外食 ", group: "食費" })).toEqual({ ok: false, error: "変更がありません" });
  });
  it("他のカテゴリと同じ名前・空の名前はエラー", () => {
    expect(buildCategoryPatch(sample, current, { name: "日用品", group: "食費" })).toEqual({ ok: false, error: "「日用品」というカテゴリは既にあります" });
    expect(buildCategoryPatch(sample, current, { name: "", group: "食費" })).toMatchObject({ ok: false });
  });
});

describe("checkGroupRename", () => {
  const groups = groupCategories(sample);
  it("新しい名前", () => {
    expect(checkGroupRename(groups, "生活", "暮らし")).toEqual({ ok: true, value: "暮らし", merge: false });
  });
  it("既存の別の大分類と同じ名前は統合として通す", () => {
    expect(checkGroupRename(groups, "生活", "食費")).toEqual({ ok: true, value: "食費", merge: true });
  });
  it("今と同じ・空はエラー", () => {
    expect(checkGroupRename(groups, "生活", " 生活 ")).toEqual({ ok: false, error: "変更がありません" });
    expect(checkGroupRename(groups, "生活", "")).toMatchObject({ ok: false });
  });
});

describe("defaultMoveTarget", () => {
  const groups = groupCategories(sample);
  it("同じ大分類の別のカテゴリを優先する", () => {
    expect(defaultMoveTarget(groups, "外食")).toBe("食費");
    expect(defaultMoveTarget(groups, "食費")).toBe("外食");
  });
  it("同じ大分類に他が無ければ、先頭の候補", () => {
    expect(defaultMoveTarget(groups, "光熱費")).toBe("食費");
  });
  it("候補が無ければ空", () => {
    expect(defaultMoveTarget(groupCategories([cat("その他", "その他")]), "その他")).toBe("");
  });
});

describe("errorText", () => {
  it("文頭の項目名を除いて、複数は「 / 」でつなぐ", () => {
    expect(errorText([{ message: "name: 「外食」というカテゴリは既にあります" }, { message: "move_to: 移し先を指定してください" }])).toBe(
      "「外食」というカテゴリは既にあります / 移し先を指定してください",
    );
  });
  it("項目名のない文はそのまま。空なら既定の文", () => {
    expect(errorText([{ message: "サーバーの応答を読めませんでした(500)" }])).toBe("サーバーの応答を読めませんでした(500)");
    expect(errorText([])).toBe("うまくいきませんでした。");
  });
});

describe("moveTargets / canDeleteAny / usageLabel", () => {
  it("移し先は、自分以外のカテゴリを大分類ごとに(空になる大分類は出さない)", () => {
    expect(moveTargets(groupCategories(sample), "光熱費").map((g) => g.group_name)).toEqual(["食費", "生活"]);
    expect(moveTargets(groupCategories(sample), "外食")[0]!.categories.map((c) => c.name)).toEqual(["食費"]);
  });
  it("最後の1つは削除できない", () => {
    expect(canDeleteAny([cat("その他", "その他")])).toBe(false);
    expect(canDeleteAny(sample)).toBe(true);
  });
  it("使用件数の表示", () => {
    expect(usageLabel(0)).toBe("未使用");
    expect(usageLabel(3)).toBe("3件");
    expect(usageLabel(1234)).toBe("1,234件");
  });
});
