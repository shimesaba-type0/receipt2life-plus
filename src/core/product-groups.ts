import { z } from "zod";
import { normalizeForSearch } from "./search";
import { toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

// 商品の「まとめ名」。表記ゆれ(牛乳・ミルク)や似た商品を、1つにくくって集計する。元の明細は変えない
// グループは、まとめ名と、含める言葉(複数)。まとめ名そのものも言葉として使う。商品の名前(統一名か品名)に言葉が含まれていれば、そのグループに入る
// 1つの商品が複数のグループの言葉に当たるときは、いちばん長い言葉のグループに入れる(同じ長さなら、先に作ったグループ)。二重には数えない
// 全角半角・かなカナ・大文字小文字は区別しない。画面から作る・直す・消す

export const MAX_GROUP_NAME = 30;
export const MAX_GROUP_WORD = 30;
export const MAX_WORDS_PER_GROUP = 20;
export const MAX_GROUPS = 100;

const nameField = z.string({ error: "name は文字列で指定してください" }).trim().min(1, "name は空にできません").max(MAX_GROUP_NAME, `name は${MAX_GROUP_NAME}文字以内にしてください`);
const wordField = z.string({ error: "words は文字列の配列で指定してください" }).trim().min(1, "words に空の言葉は入れられません").max(MAX_GROUP_WORD, `words の言葉は${MAX_GROUP_WORD}文字以内にしてください`);

export const groupInputSchema = z.strictObject({
  name: nameField.describe("まとめ名(例: 牛乳)。言葉としても使われる"),
  words: z.array(wordField).max(MAX_WORDS_PER_GROUP, `words は${MAX_WORDS_PER_GROUP}個までです`).default([]).describe("このまとめに含める言葉(例: ミルク、低脂肪乳)。商品の名前にこの言葉が含まれていれば、このまとめに入る"),
});

export interface GroupView {
  id: string;
  name: string;
  // まとめ名以外の言葉(登録順)
  words: string[];
}

interface Needle {
  norm: string;
  group: string;
  order: number;
}

/** グループの一覧(作った順) */
export async function loadGroups(db: D1Database): Promise<GroupView[]> {
  const { results: groups } = await db.prepare("SELECT id, name FROM product_groups ORDER BY created_at, id").all<{ id: string; name: string }>();
  const { results: words } = await db.prepare("SELECT group_id, word FROM product_group_words ORDER BY created_at, id").all<{ group_id: string; word: string }>();
  const byGroup = new Map<string, string[]>();
  for (const w of words) byGroup.set(w.group_id, [...(byGroup.get(w.group_id) ?? []), w.word]);
  return groups.map((g) => ({ id: g.id, name: g.name, words: byGroup.get(g.id) ?? [] }));
}

/** 商品の名前から、入るグループ名を引く関数。当たる言葉がなければ null。いちばん長い言葉(同じなら先に作ったグループ)が勝つ */
export function buildGroupMatcher(groups: readonly GroupView[]): (key: string) => string | null {
  const needles: Needle[] = [];
  groups.forEach((g, order) => {
    for (const w of [g.name, ...g.words]) {
      const norm = normalizeForSearch(w);
      if (norm !== "") needles.push({ norm, group: g.name, order });
    }
  });
  return (key) => {
    const n = normalizeForSearch(key);
    let best: Needle | null = null;
    for (const nd of needles) {
      if (!n.includes(nd.norm)) continue;
      if (!best || nd.norm.length > best.norm.length || (nd.norm.length === best.norm.length && nd.order < best.order)) best = nd;
    }
    return best ? best.group : null;
  };
}

export type GroupsResult = { ok: true; groups: GroupView[] } | { ok: false; errors: FieldError[] };
export type GroupSaved = { ok: true; group: GroupView; message: string } | { ok: false; errors: FieldError[] };

export async function listGroups(db: D1Database): Promise<GroupsResult> {
  return { ok: true, groups: await loadGroups(db) };
}

const normSet = (name: string, words: readonly string[]) => [...new Set([name, ...words].map((w) => normalizeForSearch(w)).filter((w) => w !== ""))];

// 他のグループと同じ言葉を使っていないか(同じ言葉が2つのグループにあると、どちらに入るか決まらないため)
function clash(others: readonly GroupView[], name: string, words: readonly string[]): FieldError | null {
  const mine = normSet(name, words);
  for (const g of others) {
    const theirs = new Set(normSet(g.name, g.words));
    const hit = mine.find((w) => theirs.has(w));
    if (hit) return { field: "words", message: `words: 「${hit}」は、まとめ「${g.name}」で使われています(同じ言葉は、1つのまとめにだけ入れられます)` };
  }
  return null;
}

async function save(db: D1Database, id: string | null, input: unknown, now: Date): Promise<GroupSaved> {
  const parsed = groupInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const name = parsed.data.name;
  const nameNorm = normalizeForSearch(name);
  // まとめ名と同じ言葉(表記違いを含む)は、重ねて入れない
  const seen = new Set<string>([nameNorm]);
  const words: string[] = [];
  for (const w of parsed.data.words) {
    const n = normalizeForSearch(w);
    if (!seen.has(n)) {
      seen.add(n);
      words.push(w);
    }
  }
  const all = await loadGroups(db);
  if (id === null && all.length >= MAX_GROUPS) return { ok: false, errors: [{ field: "name", message: `name: まとめは${MAX_GROUPS}個までです` }] };
  if (id !== null && !all.some((g) => g.id === id)) return { ok: false, errors: [{ field: "id", message: "id: 指定した id というまとめはありません" }] };
  const others = all.filter((g) => g.id !== id);
  if (others.some((g) => g.name === name)) return { ok: false, errors: [{ field: "name", message: `name: 「${name}」は、もう登録されています` }] };
  const conflict = clash(others, name, words);
  if (conflict) return { ok: false, errors: [conflict] };

  const at = now.toISOString();
  const groupId = id ?? `pgr_${crypto.randomUUID()}`;
  const stmts: D1PreparedStatement[] = [];
  if (id === null) stmts.push(db.prepare("INSERT INTO product_groups (id, name, created_at) VALUES (?, ?, ?)").bind(groupId, name, at));
  else stmts.push(db.prepare("UPDATE product_groups SET name = ? WHERE id = ?").bind(name, groupId), db.prepare("DELETE FROM product_group_words WHERE group_id = ?").bind(groupId));
  words.forEach((w, i) => stmts.push(db.prepare("INSERT INTO product_group_words (id, group_id, word, created_at) VALUES (?, ?, ?, ?)").bind(`pgw_${crypto.randomUUID()}`, groupId, w, `${at}#${String(i).padStart(3, "0")}`)));
  await db.batch(stmts);
  return { ok: true, group: { id: groupId, name, words }, message: id === null ? `まとめ「${name}」を作りました` : `まとめ「${name}」を直しました` };
}

export const createGroup = (db: D1Database, input: unknown, options: CoreOptions = {}) => save(db, null, input, options.now ?? new Date());

export async function updateGroup(db: D1Database, id: string, input: unknown, options: CoreOptions = {}): Promise<GroupSaved> {
  return save(db, id, input, options.now ?? new Date());
}

export async function deleteGroup(db: D1Database, id: string): Promise<{ ok: true; id: string; message: string } | { ok: false; errors: FieldError[] }> {
  const row = await db.prepare("SELECT name FROM product_groups WHERE id = ?").bind(id).first<{ name: string }>();
  if (!row) return { ok: false, errors: [{ field: "id", message: "id: 指定した id というまとめはありません" }] };
  await db.batch([db.prepare("DELETE FROM product_group_words WHERE group_id = ?").bind(id), db.prepare("DELETE FROM product_groups WHERE id = ?").bind(id)]);
  return { ok: true, id, message: `まとめ「${row.name}」を消しました(元の明細は変わりません)` };
}
