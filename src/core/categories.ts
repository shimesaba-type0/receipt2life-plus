export interface CategoryView {
  name: string;
  group_name: string;
}

export interface ListCategoriesResult {
  ok: true;
  categories: CategoryView[];
  accounts: string[];
  message: string;
}

// 登録時に選べるカテゴリと口座。並びは登録順(rowid)で安定させる
export async function listCategories(db: D1Database): Promise<ListCategoriesResult> {
  const [categories, accounts] = await Promise.all([
    db.prepare("SELECT name, group_name FROM categories ORDER BY rowid").all<CategoryView>(),
    db.prepare("SELECT name FROM accounts ORDER BY rowid").all<{ name: string }>(),
  ]);
  const accountNames = accounts.results.map((a) => a.name);
  return {
    ok: true,
    categories: categories.results,
    accounts: accountNames,
    message: `カテゴリ: ${categories.results.map((c) => c.name).join("、")}。口座: ${accountNames.join("、")}`,
  };
}
