import type { CategoriesData, CategoryIconKey } from "../../src/api/contract";

// カテゴリのアイコンのキーと日本語ラベル。src/core/category-icons.ts の CATEGORY_ICONS と同じ並び・同じ文言
// (UI は core を import しない決まりなので、ここに持つ。tests/ui/category-icons.test.ts が一致を確かめる)
export const UI_CATEGORY_ICONS: readonly { key: CategoryIconKey; label: string }[] = [
  { key: "food", label: "食事" },
  { key: "cafe", label: "カフェ" },
  { key: "grocery", label: "食料品" },
  { key: "daily", label: "日用品" },
  { key: "transit", label: "電車・バス" },
  { key: "taxi", label: "タクシー" },
  { key: "car", label: "クルマ" },
  { key: "fuel", label: "ガソリン" },
  { key: "social", label: "交際" },
  { key: "entertainment", label: "娯楽・音楽" },
  { key: "movie", label: "映画" },
  { key: "education", label: "教育・教養" },
  { key: "book", label: "本" },
  { key: "clothes", label: "服" },
  { key: "beauty", label: "美容" },
  { key: "medical", label: "医療" },
  { key: "insurance", label: "保険" },
  { key: "phone", label: "通信" },
  { key: "utility", label: "水道・光熱" },
  { key: "home", label: "住まい" },
  { key: "tax", label: "税金" },
  { key: "bigspend", label: "大型出費" },
  { key: "travel", label: "旅行" },
  { key: "gift", label: "贈り物" },
  { key: "kids", label: "子ども" },
  { key: "pet", label: "ペット" },
  { key: "sports", label: "スポーツ" },
  { key: "hobby", label: "趣味" },
  { key: "subscription", label: "サブスク" },
  { key: "bank", label: "金融" },
  { key: "other", label: "その他" },
];

// 未設定(null)・知らないキーの見た目
export const FALLBACK_ICON: CategoryIconKey = "other";

export function isCategoryIconKey(value: unknown): value is CategoryIconKey {
  return typeof value === "string" && UI_CATEGORY_ICONS.some((i) => i.key === value);
}

// 画面に出すキー。null・未知のキーは「その他」
export function resolveCategoryIcon(value: string | null | undefined): CategoryIconKey {
  return isCategoryIconKey(value) ? value : FALLBACK_ICON;
}

export function categoryIconLabel(key: CategoryIconKey): string {
  return UI_CATEGORY_ICONS.find((i) => i.key === key)?.label ?? "その他";
}

// カテゴリ名からチップに付けるアイコンを引く。カテゴリ名が無い、またはカテゴリの一覧に無い(一覧を読み込めなかった場合を含む)ときは null で、文字だけで表示する。
// 一覧にあってアイコン未設定のカテゴリは「その他」
export function chipIcon(cats: Pick<CategoriesData, "categories">, category: string | null | undefined): CategoryIconKey | null {
  if (!category) return null;
  const found = cats.categories.find((c) => c.name === category);
  return found ? resolveCategoryIcon(found.icon) : null;
}
