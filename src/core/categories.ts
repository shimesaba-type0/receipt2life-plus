import { z } from "zod";
import { CATEGORY_ICON_DESCRIPTION, categoryIconSchema, type CategoryIconKey } from "./category-icons";
import { toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

export const MAX_CATEGORY_NAME = 30;
export const MAX_GROUP_NAME = 20;

// カテゴリ名(取引が名前で引く)と大分類名。前後の空白は取り除く。MCP / API / UI の検証をこの定義で兼ねる
export const categoryNameField = (field: string) =>
  z
    .string({ error: `${field} は文字列で指定してください` })
    .trim()
    .min(1, `${field} は空にできません`)
    .max(MAX_CATEGORY_NAME, `${field} は${MAX_CATEGORY_NAME}文字以内にしてください`)
    // 名前は URL のパス(/api/categories/:name)に入る。「.」「..」だけの名前は、ブラウザが別のパスに直してしまうので使えない
    .regex(/[^.]/, `${field} は「.」だけにはできません`);
const groupNameField = (field: string) =>
  z.string({ error: `${field} は文字列で指定してください` }).trim().min(1, `${field} は空にできません`).max(MAX_GROUP_NAME, `${field} は${MAX_GROUP_NAME}文字以内にしてください`);

export const addCategorySchema = z.strictObject({
  name: categoryNameField("name").describe("新しいカテゴリ(サブカテゴリ)の名前。30文字まで。全体で一意(取引の登録で名前から引く)。必須"),
  group_name: groupNameField("group_name").describe("所属させる大分類の名前。20文字まで。既存の大分類でも新しい大分類でもよい(新しければ大分類が増える)。必須"),
  icon: categoryIconSchema.nullable().optional().describe(`${CATEGORY_ICON_DESCRIPTION}新しいカテゴリには合うアイコンを付ける。省略すると未設定(画面では other と同じ見た目)`),
});

export const updateCategoryFieldsSchema = z.strictObject({
  name: categoryNameField("name").describe("対象のカテゴリの今の名前(list_categories で確かめる)。必須"),
  new_name: categoryNameField("new_name").optional().describe("新しい名前。30文字まで、他のカテゴリと重複不可。省略すると変えない"),
  group_name: groupNameField("group_name").optional().describe("移す先の大分類。20文字まで。新しい名前なら大分類が増える。省略すると変えない"),
  icon: categoryIconSchema.nullable().optional().describe(`${CATEGORY_ICON_DESCRIPTION}null で外す(未設定に戻す)。省略すると変えない`),
});

export const deleteCategoryFieldsSchema = z.strictObject({
  name: categoryNameField("name").describe("削除するカテゴリの名前。必須"),
  move_to: categoryNameField("move_to").optional().describe("そのカテゴリを使っている支出の移し先のカテゴリ名。使っている支出があるときは必須。使っていなければ省略"),
});

export const renameGroupSchema = z.strictObject({
  group: groupNameField("group").describe("今の大分類の名前。必須"),
  new_name: groupNameField("new_name").describe("新しい大分類の名前。20文字まで。既存の別の大分類と同じ名前にすると、その大分類に統合される。必須"),
});

export interface CategoryView {
  name: string;
  group_name: string;
  // アイコンのキー(src/core/category-icons.ts)。未設定は null(画面では other と同じ見た目)
  icon: CategoryIconKey | null;
  // このカテゴリを使っている支出の件数(取引のカテゴリ + 明細の行のカテゴリ)
  usage: number;
}

export interface CategoryGroupView {
  group_name: string;
  categories: { name: string; icon: CategoryIconKey | null; usage: number }[];
}

export interface ListCategoriesResult {
  ok: true;
  // 大分類ごと・追加順に並べた一覧
  categories: CategoryView[];
  // 同じ内容を大分類ごとにまとめたもの
  groups: CategoryGroupView[];
  accounts: string[];
  message: string;
}

export type CategoryResult =
  | { ok: true; category: CategoryView; created_group: boolean; message: string }
  | { ok: false; errors: FieldError[] };

export type RenameGroupResult =
  | { ok: true; group: string; previous: string; updated: number; merged: boolean; message: string }
  | { ok: false; errors: FieldError[] };

export type DeleteCategoryResult =
  | { ok: true; deleted: { name: string; group_name: string }; moved: number; move_to: string | null; message: string }
  | { ok: false; errors: FieldError[] };

interface CategoryRow {
  id: string;
  name: string;
  group_name: string;
  icon: string | null;
}

const fail = (field: string, message: string): { ok: false; errors: FieldError[] } => ({ ok: false, errors: [{ field, message: `${field}: ${message}` }] });

// 追加順(rowid)で読む。大分類の並びは「最初に現れた順」で、ここから決まる
const allRows = async (db: D1Database) => (await db.prepare("SELECT id, name, group_name, icon FROM categories ORDER BY rowid").all<CategoryRow>()).results;

const findByName = (rows: CategoryRow[], name: string) => rows.find((r) => r.name === name);
const names = (rows: CategoryRow[]) => rows.map((r) => r.name).join("、");

// 取引のカテゴリと、明細の行のカテゴリ(行自身に付いたもの)の両方を数える
const USAGE = (col: string) =>
  `(SELECT COUNT(*) FROM transactions t WHERE t.category_id = ${col}) + (SELECT COUNT(*) FROM transaction_items i WHERE i.category_id = ${col})`;

async function usageOf(db: D1Database, id: string): Promise<number> {
  const row = await db.prepare(`SELECT ${USAGE("?1")} AS n`).bind(id).first<{ n: number }>();
  return row?.n ?? 0;
}

// 登録時に選べるカテゴリと口座。大分類ごと(最初に現れた順)・追加順(rowid)で並べ、並びを安定させる
export async function listCategories(db: D1Database): Promise<ListCategoriesResult> {
  const [categories, accounts] = await Promise.all([
    db
      .prepare(
        `SELECT c.name AS name, c.group_name AS group_name, c.icon AS icon, ${USAGE("c.id")} AS usage
         FROM categories c ORDER BY c.rowid`,
      )
      .all<CategoryView>(),
    db.prepare("SELECT name FROM accounts ORDER BY rowid").all<{ name: string }>(),
  ]);
  const byGroup = new Map<string, CategoryGroupView>();
  for (const c of categories.results) {
    const g = byGroup.get(c.group_name) ?? { group_name: c.group_name, categories: [] };
    g.categories.push({ name: c.name, icon: c.icon, usage: c.usage });
    byGroup.set(c.group_name, g);
  }
  const groups = [...byGroup.values()];
  const accountNames = accounts.results.map((a) => a.name);
  return {
    ok: true,
    categories: groups.flatMap((g) => g.categories.map((c) => ({ name: c.name, group_name: g.group_name, icon: c.icon, usage: c.usage }))),
    groups,
    accounts: accountNames,
    message: `カテゴリ(大分類: サブカテゴリ): ${groups.map((g) => `${g.group_name}: ${g.categories.map((c) => c.name).join("、")}`).join(" / ")}。口座: ${accountNames.join("、")}`,
  };
}

export async function addCategory(db: D1Database, input: unknown): Promise<CategoryResult> {
  const parsed = addCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { name, group_name, icon = null } = parsed.data;

  const rows = await allRows(db);
  if (findByName(rows, name)) return fail("name", `「${name}」というカテゴリは既にあります。別の名前にするか、update_category で既存のものを変更してください`);
  const createdGroup = !rows.some((r) => r.group_name === group_name);

  await db.prepare("INSERT INTO categories (id, name, group_name, icon) VALUES (?, ?, ?, ?)").bind(`cat_${crypto.randomUUID()}`, name, group_name, icon).run();
  return {
    ok: true,
    category: { name, group_name, icon, usage: 0 },
    created_group: createdGroup,
    message: `カテゴリ「${name}」を大分類「${group_name}」に追加しました${createdGroup ? "(新しい大分類)" : ""}。add_transactions の category に使えます`,
  };
}

export async function updateCategory(db: D1Database, input: unknown): Promise<CategoryResult> {
  const parsed = updateCategoryFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { name, new_name: newName, group_name: newGroup, icon: newIcon } = parsed.data;
  if (newName === undefined && newGroup === undefined && newIcon === undefined) {
    return fail("input", "更新する項目(new_name / group_name / icon)を1つ以上指定してください");
  }

  const rows = await allRows(db);
  const current = findByName(rows, name);
  if (!current) return fail("name", `「${name}」というカテゴリはありません。選べる値: ${names(rows)}`);

  const nextName = newName ?? current.name;
  const nextGroup = newGroup ?? current.group_name;
  // icon は省略で変えない・null で外す
  const nextIcon = newIcon === undefined ? current.icon : newIcon;
  if (nextName === current.name && nextGroup === current.group_name && nextIcon === current.icon) {
    return fail("input", "変更する内容がありません(名前も大分類もアイコンも今と同じです)");
  }
  if (nextName !== current.name && findByName(rows, nextName)) {
    return fail("new_name", `「${nextName}」というカテゴリは既にあります。別の名前にしてください`);
  }

  await db.prepare("UPDATE categories SET name = ?, group_name = ?, icon = ? WHERE id = ?").bind(nextName, nextGroup, nextIcon, current.id).run();
  const createdGroup = nextGroup !== current.group_name && !rows.some((r) => r.group_name === nextGroup);
  const changes = [
    ...(nextName !== current.name ? [`名前 ${current.name} → ${nextName}`] : []),
    ...(nextGroup !== current.group_name ? [`大分類 ${current.group_name} → ${nextGroup}${createdGroup ? "(新しい大分類)" : ""}`] : []),
    ...(nextIcon !== current.icon ? [`アイコン ${current.icon ?? "なし"} → ${nextIcon ?? "なし"}`] : []),
  ];
  // 取引はカテゴリのIDで参照しているので、名前や大分類を変えても取引の更新は要らない(status・dedup_hash にも影響しない)
  return {
    ok: true,
    category: { name: nextName, group_name: nextGroup, icon: nextIcon as CategoryIconKey | null, usage: await usageOf(db, current.id) },
    created_group: createdGroup,
    message: `カテゴリを更新しました: ${changes.join("、")}`,
  };
}

export async function renameGroup(db: D1Database, input: unknown): Promise<RenameGroupResult> {
  const parsed = renameGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { group, new_name: newName } = parsed.data;

  const rows = await allRows(db);
  const members = rows.filter((r) => r.group_name === group);
  if (members.length === 0) {
    return fail("group", `「${group}」という大分類はありません。選べる値: ${[...new Set(rows.map((r) => r.group_name))].join("、")}`);
  }
  if (newName === group) return fail("new_name", "変更する内容がありません(今の名前と同じです)");

  const merged = rows.some((r) => r.group_name === newName);
  await db.prepare("UPDATE categories SET group_name = ? WHERE group_name = ?").bind(newName, group).run();
  return {
    ok: true,
    group: newName,
    previous: group,
    updated: members.length,
    merged,
    message: `大分類「${group}」を「${newName}」に変更しました(${members.length}件のカテゴリ)${merged ? "。既にあった同名の大分類に統合しました" : ""}`,
  };
}

export async function deleteCategory(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<DeleteCategoryResult> {
  const parsed = deleteCategoryFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { name, move_to: moveTo } = parsed.data;

  const rows = await allRows(db);
  const current = findByName(rows, name);
  if (!current) return fail("name", `「${name}」というカテゴリはありません。選べる値: ${names(rows)}`);
  if (rows.length <= 1) return fail("name", "最後の1つのカテゴリは削除できません。先に別のカテゴリを追加してください");

  const usage = await usageOf(db, current.id);
  if (usage > 0 && moveTo === undefined) {
    return fail("move_to", `「${name}」を${usage}件の支出が使っています。move_to で移し先のカテゴリを指定してください`);
  }
  let target: CategoryRow | undefined;
  if (moveTo !== undefined) {
    if (moveTo === name) return fail("move_to", "移し先は、削除するカテゴリとは別のものにしてください");
    target = findByName(rows, moveTo);
    if (!target) return fail("move_to", `「${moveTo}」というカテゴリはありません。選べる値: ${names(rows.filter((r) => r.id !== current.id))}`);
  }

  const statements: D1PreparedStatement[] = [];
  if (target && usage > 0) {
    // 付け替え前後ともカテゴリありなので、status(店名とカテゴリの有無)は変わらない。dedup_hash にもカテゴリは含まれない
    // 明細の行に付いたカテゴリも、同じ移し先に付け替える
    statements.push(
      db.prepare("UPDATE transactions SET category_id = ?, updated_at = ? WHERE category_id = ?").bind(target.id, (options.now ?? new Date()).toISOString(), current.id),
      db.prepare("UPDATE transaction_items SET category_id = ? WHERE category_id = ?").bind(target.id, current.id),
    );
  }
  statements.push(db.prepare("DELETE FROM categories WHERE id = ?").bind(current.id));
  await db.batch(statements);

  const moved = target && usage > 0 ? usage : 0;
  return {
    ok: true,
    deleted: { name: current.name, group_name: current.group_name },
    moved,
    move_to: moved > 0 ? target!.name : null,
    message: `カテゴリ「${name}」を削除しました${moved > 0 ? `(${moved}件の支出を「${target!.name}」に移しました)` : ""}`,
  };
}
