import { z } from "zod";
import { SEARCH_TYPES } from "./search";
import { toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

// 検索画面の「よく使う検索」チップ。ラベルと、探す言葉(q)・対象(type)の組を保存し、押すとその検索になる
// q も type も空のチップは作れない(押しても何も起きないため)。画面から足したり消したりできる

export const MAX_CHIP_LABEL = 20;
export const MAX_CHIPS = 30;

export const addChipSchema = z.strictObject({
  label: z.string({ error: "label は文字列で指定してください" }).trim().min(1, "label は空にできません").max(MAX_CHIP_LABEL, `label は${MAX_CHIP_LABEL}文字以内にしてください`).describe("チップに出す名前"),
  q: z.string({ error: "q は文字列で指定してください" }).trim().max(200, "q は200文字以内にしてください").default("").describe("探す言葉(空白で区切ると、すべてを含むものに絞る)。空でもよい(その場合は type が必要)"),
  type: z.enum(SEARCH_TYPES, { error: `type は ${SEARCH_TYPES.join(" / ")} のいずれかで指定してください` }).nullable().optional().describe("探す対象。省略すると、すべての種類"),
});

export interface ChipView {
  id: string;
  label: string;
  q: string;
  type: (typeof SEARCH_TYPES)[number] | null;
}

export type ChipsResult = { ok: true; chips: ChipView[] } | { ok: false; errors: FieldError[] };

export async function listChips(db: D1Database): Promise<ChipsResult> {
  const { results } = await db.prepare("SELECT id, label, q, type FROM search_chips ORDER BY position, created_at").all<ChipView>();
  return { ok: true, chips: results };
}

export async function addChip(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<{ ok: true; chip: ChipView; message: string } | { ok: false; errors: FieldError[] }> {
  const parsed = addChipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { label, q } = parsed.data;
  const type = parsed.data.type ?? null;
  if (q === "" && type === null) return { ok: false, errors: [{ field: "q", message: "q: 探す言葉か、探す対象のどちらかは入れてください" }] };
  const existing = await db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM search_chips").first<{ n: number; pos: number }>();
  if ((existing?.n ?? 0) >= MAX_CHIPS) return { ok: false, errors: [{ field: "label", message: `label: チップは${MAX_CHIPS}個までです` }] };
  const dup = await db.prepare("SELECT 1 AS x FROM search_chips WHERE label = ?").bind(label).first();
  if (dup) return { ok: false, errors: [{ field: "label", message: `label: 「${label}」は、もう登録されています` }] };
  const id = `chip_${crypto.randomUUID()}`;
  await db
    .prepare("INSERT INTO search_chips (id, label, q, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, label, q, type, (existing?.pos ?? 0) + 1, (options.now ?? new Date()).toISOString())
    .run();
  return { ok: true, chip: { id, label, q, type }, message: `「${label}」を、検索のチップに足しました` };
}

export async function deleteChip(db: D1Database, input: unknown): Promise<{ ok: true; id: string; message: string } | { ok: false; errors: FieldError[] }> {
  const parsed = z.strictObject({ id: z.string().trim().min(1, "id は必須です") }).safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const row = await db.prepare("SELECT label FROM search_chips WHERE id = ?").bind(parsed.data.id).first<{ label: string }>();
  if (!row) return { ok: false, errors: [{ field: "id", message: "id: 指定した id というチップはありません" }] };
  await db.prepare("DELETE FROM search_chips WHERE id = ?").bind(parsed.data.id).run();
  return { ok: true, id: parsed.data.id, message: `「${row.label}」を、チップから消しました` };
}
