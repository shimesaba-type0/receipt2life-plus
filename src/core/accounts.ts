import { z } from "zod";
import { categoryNameField } from "./categories";
import { toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

// 口座(支払方法)の名前。長さの上限・空白・「.」だけの禁止はカテゴリ名と同じ(名前は URL のパス /api/accounts/:name に入る)
export const accountNameField = categoryNameField;

export const addAccountSchema = z.strictObject({
  name: accountNameField("name").describe("新しい口座(支払方法)の名前。30文字まで。全体で一意(取引の登録で名前から引く)。必須"),
});

export const updateAccountFieldsSchema = z.strictObject({
  name: accountNameField("name").describe("対象の口座の今の名前(list_categories の accounts で確かめる)。必須"),
  new_name: accountNameField("new_name").describe("新しい名前。30文字まで、他の口座と重複不可。必須"),
});

export const deleteAccountFieldsSchema = z.strictObject({
  name: accountNameField("name").describe("削除する口座の名前。必須"),
  move_to: accountNameField("move_to").optional().describe("その口座を使っている支出の移し先の口座名。使っている支出があるときは必須。使っていなければ省略"),
});

export interface AccountView {
  name: string;
  // この口座を使っている取引の件数
  usage: number;
}

export type ListAccountsResult = { ok: true; accounts: AccountView[]; message: string };

export type AccountResult = { ok: true; account: AccountView; message: string } | { ok: false; errors: FieldError[] };

export type DeleteAccountResult =
  | { ok: true; deleted: { name: string }; moved: number; move_to: string | null; message: string }
  | { ok: false; errors: FieldError[] };

interface AccountRow {
  id: string;
  name: string;
}

const fail = (field: string, message: string): { ok: false; errors: FieldError[] } => ({ ok: false, errors: [{ field, message: `${field}: ${message}` }] });

// 追加順(rowid)で読む
const allRows = async (db: D1Database) => (await db.prepare("SELECT id, name FROM accounts ORDER BY rowid").all<AccountRow>()).results;
const findByName = (rows: AccountRow[], name: string) => rows.find((r) => r.name === name);
const names = (rows: AccountRow[]) => rows.map((r) => r.name).join("、");

async function usageOf(db: D1Database, id: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?").bind(id).first<{ n: number }>();
  return row?.n ?? 0;
}

// 口座の一覧(追加順)。usage は使っている取引の件数
export async function listAccounts(db: D1Database): Promise<ListAccountsResult> {
  const res = await db
    .prepare("SELECT a.name AS name, (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS usage FROM accounts a ORDER BY a.rowid")
    .all<AccountView>();
  const accounts = res.results;
  return { ok: true, accounts, message: `口座: ${accounts.map((a) => a.name).join("、") || "(なし)"}` };
}

export async function addAccount(db: D1Database, input: unknown): Promise<AccountResult> {
  const parsed = addAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { name } = parsed.data;

  const rows = await allRows(db);
  if (findByName(rows, name)) return fail("name", `「${name}」という口座は既にあります。別の名前にするか、update_account で既存のものを変更してください`);

  await db.prepare("INSERT INTO accounts (id, name) VALUES (?, ?)").bind(`acc_${crypto.randomUUID()}`, name).run();
  return { ok: true, account: { name, usage: 0 }, message: `口座「${name}」を追加しました。add_transactions の account に使えます` };
}

export async function updateAccount(db: D1Database, input: unknown): Promise<AccountResult> {
  const parsed = updateAccountFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { name, new_name: newName } = parsed.data;

  const rows = await allRows(db);
  const current = findByName(rows, name);
  if (!current) return fail("name", `「${name}」という口座はありません。選べる値: ${names(rows)}`);
  if (newName === current.name) return fail("new_name", "変更する内容がありません(今の名前と同じです)");
  if (findByName(rows, newName)) return fail("new_name", `「${newName}」という口座は既にあります。別の名前にしてください`);

  await db.prepare("UPDATE accounts SET name = ? WHERE id = ?").bind(newName, current.id).run();
  // 取引は口座のIDで参照しているので、名前を変えても取引の更新は要らない(表示は自動で新しい名前になる)
  return {
    ok: true,
    account: { name: newName, usage: await usageOf(db, current.id) },
    message: `口座の名前を変更しました: ${current.name} → ${newName}`,
  };
}

export async function deleteAccount(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<DeleteAccountResult> {
  const parsed = deleteAccountFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { name, move_to: moveTo } = parsed.data;

  const rows = await allRows(db);
  const current = findByName(rows, name);
  if (!current) return fail("name", `「${name}」という口座はありません。選べる値: ${names(rows)}`);

  const usage = await usageOf(db, current.id);
  if (usage > 0 && moveTo === undefined) {
    return fail("move_to", `「${name}」を${usage}件の支出が使っています。move_to で移し先の口座を指定してください`);
  }
  let target: AccountRow | undefined;
  if (moveTo !== undefined) {
    if (moveTo === name) return fail("move_to", "移し先は、削除する口座とは別のものにしてください");
    target = findByName(rows, moveTo);
    if (!target) return fail("move_to", `「${moveTo}」という口座はありません。選べる値: ${names(rows.filter((r) => r.id !== current.id))}`);
  }

  const statements: D1PreparedStatement[] = [];
  if (target && usage > 0) {
    // 口座は status・dedup_hash に影響しない
    statements.push(db.prepare("UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ?").bind(target.id, (options.now ?? new Date()).toISOString(), current.id));
  }
  statements.push(db.prepare("DELETE FROM accounts WHERE id = ?").bind(current.id));
  await db.batch(statements);

  const moved = target && usage > 0 ? usage : 0;
  return {
    ok: true,
    deleted: { name: current.name },
    moved,
    move_to: moved > 0 ? target!.name : null,
    message: `口座「${name}」を削除しました${moved > 0 ? `(${moved}件の支出を「${target!.name}」に移しました)` : ""}`,
  };
}
