import type { CategoriesData } from "../../../src/api/contract";

// 「大分類・カテゴリ」を1つのチップ文言にする。大分類が分からない・同名ならカテゴリ名だけ。未設定は null
export function categoryChipLabel(category: string | null, cats: CategoriesData): string | null {
  if (!category) return null;
  const found = cats.categories.find((c) => c.name === category);
  return found && found.group_name !== category ? `${found.group_name}・${category}` : category;
}
