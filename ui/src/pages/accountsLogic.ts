// 支払方法(口座)の管理の純粋な部分(DOMに触れない。テストする)
// 上限と規則はサーバー(src/core/accounts.ts)と同じ。名前の検査はカテゴリ画面と共通
import type { AccountView } from "../../../src/api/contract";
import { MAX_CATEGORY_NAME, validateName, type NameCheck } from "./categoriesLogic";

export const MAX_ACCOUNT_NAME = MAX_CATEGORY_NAME;

const duplicateMessage = (name: string) => `「${name}」という口座は既にあります`;

// 口座の追加。名前は全体で一意
export function checkNewAccount(accounts: AccountView[], raw: string): NameCheck {
  const v = validateName(raw, "名前", MAX_ACCOUNT_NAME);
  if (!v.ok) return v;
  return accounts.some((a) => a.name === v.value) ? { ok: false, error: duplicateMessage(v.value) } : v;
}

// 名前の変更。今と同じ名前は「変更がありません」
export function checkAccountRename(accounts: AccountView[], current: string, raw: string): NameCheck {
  const v = validateName(raw, "名前", MAX_ACCOUNT_NAME);
  if (!v.ok) return v;
  if (v.value === current) return { ok: false, error: "変更がありません" };
  return accounts.some((a) => a.name === v.value) ? { ok: false, error: duplicateMessage(v.value) } : v;
}

// 削除したときの付け替え先の候補(自分を除く)
export const accountMoveTargets = (accounts: AccountView[], excluding: string): AccountView[] => accounts.filter((a) => a.name !== excluding);

// 削除の付け替え先の初期値。候補が無ければ空
export const defaultAccountMoveTarget = (accounts: AccountView[], name: string): string => accountMoveTargets(accounts, name)[0]?.name ?? "";

// 使っている支出があるのに、付け替え先が無い(= 先に別の口座を追加する必要がある)
export const needsOtherAccount = (accounts: AccountView[], name: string): boolean => {
  const usage = accounts.find((a) => a.name === name)?.usage ?? 0;
  return usage > 0 && accountMoveTargets(accounts, name).length === 0;
};
