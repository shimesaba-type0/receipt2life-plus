import { z } from "zod";

// カテゴリのアイコン。キー(英小文字)と日本語ラベル。画面の絵は ui/src/components/CategoryIcon.tsx
// UI(ui/src/categoryIcons.ts)にも同じ一覧がある。tests/ui/category-icons.test.ts が一致を確かめる
export const CATEGORY_ICONS = [
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
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICONS)[number]["key"];

export const CATEGORY_ICON_KEYS = CATEGORY_ICONS.map((i) => i.key) as [CategoryIconKey, ...CategoryIconKey[]];

// MCP の説明文とエラーで共有する「キー=意味」の一覧
export const CATEGORY_ICON_CHOICES = CATEGORY_ICONS.map((i) => `${i.key}=${i.label}`).join("、");

// 検証のスキーマ(MCP / API / UI の入力を兼ねる)。一覧にない値は、選べるキーを日本語で返す
export const categoryIconSchema = z.enum(CATEGORY_ICON_KEYS, { error: `icon は次のキーから選んでください: ${CATEGORY_ICON_CHOICES}(外すなら null)` });

export const CATEGORY_ICON_DESCRIPTION = [
  `カテゴリのアイコン。次のキーから選ぶ: ${CATEGORY_ICON_CHOICES}。`,
  "名前に合う意味のものを選ぶ(例: タクシー代なら taxi、映画なら movie)。合うものがなければ other。",
].join("");
