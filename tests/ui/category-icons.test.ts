import { describe, expect, it } from "vitest";
import type { CategoriesData, CategoryIconKey, CategoryView } from "../../src/api/contract";
import { CATEGORY_ICONS, CATEGORY_ICON_KEYS } from "../../src/core/category-icons";
import { FALLBACK_ICON, UI_CATEGORY_ICONS, categoryIconLabel, chipIcon, isCategoryIconKey, resolveCategoryIcon } from "../../ui/src/categoryIcons";
import { CATEGORY_ICON_PATHS } from "../../ui/src/categoryIconPaths";
import { buildCategoryPatch, groupCategories } from "../../ui/src/pages/categoriesLogic";

describe("アイコンの一覧", () => {
  it("UI の一覧(キー・ラベル・並び)が core の CATEGORY_ICONS と同じで、契約の型にも合う", () => {
    expect(UI_CATEGORY_ICONS.map((i) => ({ key: i.key, label: i.label }))).toEqual(CATEGORY_ICONS.map((i) => ({ key: i.key, label: i.label })));
    // contract の CategoryIconKey に core のキーが全部入る(型の検査)
    const keys: CategoryIconKey[] = [...CATEGORY_ICON_KEYS];
    expect(keys).toHaveLength(31);
    expect(new Set(keys).size).toBe(31);
  });

  it("キーは英小文字だけ", () => {
    for (const k of CATEGORY_ICON_KEYS) expect(k).toMatch(/^[a-z]+$/);
  });

  it("すべてのキーに絵(path)があり、余計なキーは無い。pathは重複せず、数値と命令だけでできている", () => {
    expect(Object.keys(CATEGORY_ICON_PATHS).sort()).toEqual([...CATEGORY_ICON_KEYS].sort());
    const seen = new Set<string>();
    for (const key of CATEGORY_ICON_KEYS) {
      const paths = CATEGORY_ICON_PATHS[key];
      expect(paths.length, key).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d, key).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
        expect(d.startsWith("M") || d.startsWith("m"), key).toBe(true);
      }
      const sig = paths.join("|");
      expect(seen.has(sig), `${key} の絵が他と同じ`).toBe(false);
      seen.add(sig);
    }
  });
});

describe("resolveCategoryIcon / categoryIconLabel", () => {
  it("知っているキーはそのまま。null・未知・空は other", () => {
    expect(resolveCategoryIcon("taxi")).toBe("taxi");
    expect(resolveCategoryIcon(null)).toBe("other");
    expect(resolveCategoryIcon(undefined)).toBe("other");
    expect(resolveCategoryIcon("rocket")).toBe(FALLBACK_ICON);
    expect(resolveCategoryIcon("")).toBe("other");
    expect(isCategoryIconKey("food")).toBe(true);
    expect(isCategoryIconKey("Food")).toBe(false);
    expect(isCategoryIconKey(3)).toBe(false);
  });

  it("日本語のラベル", () => {
    expect(categoryIconLabel("taxi")).toBe("タクシー");
    expect(categoryIconLabel("bigspend")).toBe("大型出費");
  });
});

const cat = (name: string, group_name: string, icon: CategoryIconKey | null): CategoryView => ({ name, group_name, icon, usage: 0 });
const cats: CategoriesData = { categories: [cat("食費", "食費", "food"), cat("雑費", "その他", null)], accounts: [] };

describe("chipIcon", () => {
  it("カテゴリのアイコンを引く。アイコン未設定は other", () => {
    expect(chipIcon(cats, "食費")).toBe("food");
    expect(chipIcon(cats, "雑費")).toBe("other");
  });

  it("カテゴリ名が無い・一覧に無い・一覧が読めていないときは null(文字だけで表示する)", () => {
    expect(chipIcon(cats, null)).toBeNull();
    expect(chipIcon(cats, "")).toBeNull();
    expect(chipIcon(cats, "消したカテゴリ")).toBeNull();
    expect(chipIcon({ categories: [] }, "食費")).toBeNull();
  });
});

describe("カテゴリ管理の純関数(アイコン)", () => {
  it("groupCategories は icon を引き継ぐ", () => {
    expect(groupCategories(cats.categories)[0]!.categories[0]).toEqual({ name: "食費", icon: "food", usage: 0 });
  });

  it("buildCategoryPatch: アイコンだけを変える・外す・変えない", () => {
    const current = { name: "食費", group_name: "食費", icon: "food" as CategoryIconKey | null };
    const form = { name: "食費", group: "食費" };
    expect(buildCategoryPatch(cats.categories, current, { ...form, icon: "cafe" })).toEqual({ ok: true, patch: { icon: "cafe" } });
    expect(buildCategoryPatch(cats.categories, current, { ...form, icon: null })).toEqual({ ok: true, patch: { icon: null } });
    expect(buildCategoryPatch(cats.categories, current, { ...form, icon: "food" })).toEqual({ ok: false, error: "変更がありません" });
    expect(buildCategoryPatch(cats.categories, { ...current, icon: null }, { ...form, icon: null })).toEqual({ ok: false, error: "変更がありません" });
    // 名前と同時に変える
    expect(buildCategoryPatch(cats.categories, current, { name: "外食", group: "食費", icon: "cafe" })).toEqual({ ok: true, patch: { new_name: "外食", icon: "cafe" } });
  });
});
