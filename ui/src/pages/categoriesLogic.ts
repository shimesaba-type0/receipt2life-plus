// カテゴリ画面の純粋な部分(DOMに触れない。テストする)
// 上限はサーバー(src/core/categories.ts)と同じ。送る前に検査して、理由を日本語で出す
import type { CategoryIconKey, CategoryPatch, CategoryView } from "../../../src/api/contract";

export const MAX_CATEGORY_NAME = 30;
export const MAX_GROUP_NAME = 20;

export interface GroupView {
  group_name: string;
  categories: { name: string; icon: CategoryIconKey | null; usage: number }[];
}

// API の平らな一覧を、大分類ごとにまとめる。大分類は最初に現れた順、中は元の順(サーバーの並びをそのまま使う)
export function groupCategories(categories: CategoryView[]): GroupView[] {
  const groups = new Map<string, GroupView>();
  for (const c of categories) {
    const g = groups.get(c.group_name) ?? { group_name: c.group_name, categories: [] };
    g.categories.push({ name: c.name, icon: c.icon, usage: c.usage });
    groups.set(c.group_name, g);
  }
  return [...groups.values()];
}

export type NameCheck = { ok: true; value: string } | { ok: false; error: string };

// 前後の空白を取り除いて、空・長すぎる・「.」だけを断る
export function validateName(raw: string, label: string, max: number): NameCheck {
  const value = raw.trim();
  if (value === "") return { ok: false, error: `${label}を入力してください` };
  if (value.length > max) return { ok: false, error: `${label}は${max}文字以内にしてください` };
  if (/^\.+$/.test(value)) return { ok: false, error: `${label}を「.」だけにはできません` };
  return { ok: true, value };
}

const duplicateMessage = (name: string) => `「${name}」というカテゴリは既にあります`;

// サブカテゴリの追加。名前は全体で一意
export function checkNewCategory(categories: CategoryView[], raw: string): NameCheck {
  const v = validateName(raw, "名前", MAX_CATEGORY_NAME);
  if (!v.ok) return v;
  return categories.some((c) => c.name === v.value) ? { ok: false, error: duplicateMessage(v.value) } : v;
}

export type PatchCheck = { ok: true; patch: CategoryPatch } | { ok: false; error: string };

// 編集フォームの値から、変えた項目だけの PATCH 本文を作る
export function buildCategoryPatch(
  categories: CategoryView[],
  current: { name: string; group_name: string },
  form: { name: string; group: string },
): PatchCheck {
  const v = validateName(form.name, "名前", MAX_CATEGORY_NAME);
  if (!v.ok) return v;
  const patch: CategoryPatch = {};
  if (v.value !== current.name) {
    if (categories.some((c) => c.name === v.value)) return { ok: false, error: duplicateMessage(v.value) };
    patch.new_name = v.value;
  }
  if (form.group !== current.group_name) patch.group_name = form.group;
  return Object.keys(patch).length === 0 ? { ok: false, error: "変更がありません" } : { ok: true, patch };
}

export type GroupRenameCheck = { ok: true; value: string; merge: boolean } | { ok: false; error: string };

// 大分類の名前の変更。既にある別の大分類と同じ名前なら統合(merge)
export function checkGroupRename(groups: GroupView[], group: string, raw: string): GroupRenameCheck {
  const v = validateName(raw, "大分類名", MAX_GROUP_NAME);
  if (!v.ok) return v;
  if (v.value === group) return { ok: false, error: "変更がありません" };
  return { ok: true, value: v.value, merge: groups.some((g) => g.group_name === v.value) };
}

// 削除したときの付け替え先の候補。自分を除き、空になる大分類は出さない
export function moveTargets(groups: GroupView[], excluding: string): GroupView[] {
  return groups
    .map((g) => ({ group_name: g.group_name, categories: g.categories.filter((c) => c.name !== excluding) }))
    .filter((g) => g.categories.length > 0);
}

// 最後の1つのカテゴリは削除できない
export const canDeleteAny = (categories: CategoryView[]): boolean => categories.length > 1;

export const usageLabel = (n: number): string => (n === 0 ? "未使用" : `${n.toLocaleString("en-US")}件`);

// 削除の付け替え先の初期値。同じ大分類の別のカテゴリがあればそれ、無ければ先頭の候補。候補が無ければ空
export function defaultMoveTarget(groups: GroupView[], name: string): string {
  const targets = moveTargets(groups, name);
  const own = groups.find((g) => g.categories.some((c) => c.name === name))?.group_name;
  const sameGroup = targets.find((g) => g.group_name === own);
  return (sameGroup ?? targets[0])?.categories[0]?.name ?? "";
}

// API のエラーを、画面に出す1つの文にする(サーバーの文頭の「name: 」のような項目名は除く)
export function errorText(errors: { message: string }[]): string {
  const text = errors.map((e) => e.message.replace(/^[a-z_]+:\s*/i, "")).join(" / ");
  return text || "うまくいきませんでした。";
}
