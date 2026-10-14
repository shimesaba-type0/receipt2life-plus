import { z } from "zod";
import { normalizeForSearch } from "./search";
import { toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

// 商品の集計に入れない言葉。商品の名前(統一名か品名)にこの言葉が含まれる行は、商品の一覧・履歴から外す(消費税・割引・クーポンなど)
// 全角半角・かなカナ・大文字小文字は区別せずに比べる。画面から追加・削除できる(コードを変えずに直せる)

export const MAX_EXCLUDE_WORD = 30;
export const MAX_EXCLUDES = 200;

export const addExcludeSchema = z.strictObject({
  word: z
    .string({ error: "word は文字列で指定してください" })
    .trim()
    .min(1, "word は空にできません")
    .max(MAX_EXCLUDE_WORD, `word は${MAX_EXCLUDE_WORD}文字以内にしてください`)
    .describe("数えない言葉。商品の名前にこの言葉が含まれる行を、商品の集計から外す"),
});

export const deleteExcludeSchema = z.strictObject({ id: z.string().trim().min(1, "id は必須です") });

export interface ExcludeView {
  id: string;
  word: string;
}

export type ExcludesResult = { ok: true; excludes: ExcludeView[] } | { ok: false; errors: FieldError[] };

export async function listExcludes(db: D1Database): Promise<ExcludesResult> {
  const { results } = await db.prepare("SELECT id, word FROM product_excludes ORDER BY created_at, word").all<ExcludeView>();
  return { ok: true, excludes: results };
}

/** 数えない言葉(正規化したもの)。商品の集計が、行を外すのに使う */
export async function loadExcludeNeedles(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT word FROM product_excludes").all<{ word: string }>();
  return results.map((r) => normalizeForSearch(r.word)).filter((w) => w !== "");
}

export const isExcluded = (name: string, needles: readonly string[]): boolean => {
  const n = normalizeForSearch(name);
  return needles.some((w) => n.includes(w));
};

export async function addExclude(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<{ ok: true; exclude: ExcludeView; message: string } | { ok: false; errors: FieldError[] }> {
  const parsed = addExcludeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { word } = parsed.data;
  const existing = await listExcludes(db);
  if (existing.ok) {
    if (existing.excludes.length >= MAX_EXCLUDES) return { ok: false, errors: [{ field: "word", message: `word: 数えない言葉は${MAX_EXCLUDES}件までです` }] };
    const n = normalizeForSearch(word);
    if (existing.excludes.some((e) => normalizeForSearch(e.word) === n)) return { ok: false, errors: [{ field: "word", message: `word: 「${word}」は、もう登録されています` }] };
  }
  const id = `pex_${crypto.randomUUID()}`;
  await db.prepare("INSERT INTO product_excludes (id, word, created_at) VALUES (?, ?, ?)").bind(id, word, (options.now ?? new Date()).toISOString()).run();
  return { ok: true, exclude: { id, word }, message: `「${word}」を含む商品を、集計から外しました` };
}

export async function deleteExclude(db: D1Database, input: unknown): Promise<{ ok: true; id: string; message: string } | { ok: false; errors: FieldError[] }> {
  const parsed = deleteExcludeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const row = await db.prepare("SELECT word FROM product_excludes WHERE id = ?").bind(id).first<{ word: string }>();
  if (!row) return { ok: false, errors: [{ field: "id", message: `id: 指定した id という言葉はありません` }] };
  await db.prepare("DELETE FROM product_excludes WHERE id = ?").bind(id).run();
  return { ok: true, id, message: `「${row.word}」を、集計に戻しました` };
}
