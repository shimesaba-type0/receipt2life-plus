import { z } from "zod";
import { checkRefs } from "./photos";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import { escapeLike, type CoreOptions } from "./transactions";
import { parseHttpsUrl } from "./urls";

// 買った本の記録(books)。ISBN・タイトル・著者・シリーズ名・購入者・メモを残し、あとから絞り込めるようにする。
// タイトルなどは、AI がネットで調べて入れる前提(アプリは外のサービスに接続しない)。ISBN かタイトルのどちらかは必須
// ISBN は、ハイフン・空白を取って、チェックディジットを確かめ、13桁にそろえて持つ(10桁は 978 を付けて直す)
// 買った日(purchased_on)は任意。無くて取引(レシート)に紐づいていれば、その取引の日付を使う

export const MAX_TITLE_LENGTH = 200;
export const MAX_AUTHOR_LENGTH = 100;
export const MAX_SERIES_LENGTH = 100;
export const MAX_BUYER_LENGTH = 50;
export const MAX_NOTE_LENGTH = 500;
export const MAX_COVER_URL_LENGTH = 500;
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;
// 絞り込みの候補(シリーズ・著者・購入者)の最大数
export const MAX_FACET_ROWS = 200;

/** ISBN を13桁にそろえる。形やチェックディジットが違えば null */
export function normalizeIsbn(input: string): string | null {
  const s = input.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (10 - i) * (s[i] === "X" ? 10 : Number(s[i]));
    if (sum % 11 !== 0) return null;
    const body = `978${s.slice(0, 9)}`;
    return body + String(isbn13Check(body));
  }
  if (/^\d{13}$/.test(s)) {
    return isbn13Check(s.slice(0, 12)) === Number(s[12]) ? s : null;
  }
  return null;
}

function isbn13Check(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

// 手元の状況。売った金額は記録しない(メモに書く)
export const BOOK_STATUSES = ["owned", "sold", "given", "donated", "lost", "discarded"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];
export const BOOK_STATUS_LABELS: Record<BookStatus, string> = { owned: "手元にある", sold: "売った", given: "譲った・贈った", donated: "寄贈した", lost: "なくした", discarded: "処分した" };
const STATUS_DESCRIPTION = `手元の状況: ${BOOK_STATUSES.map((v) => `${v}=${BOOK_STATUS_LABELS[v]}`).join(" / ")}。省略すると owned。売った金額は記録しない(note に書く)`;
const statusField = z.enum(BOOK_STATUSES, { error: `status は ${BOOK_STATUSES.join(" / ")} のいずれかで指定してください` });

export interface BookView {
  id: string;
  // 13桁。なければ null
  isbn: string | null;
  title: string | null;
  author: string | null;
  series: string | null;
  buyer: string | null;
  note: string | null;
  // カバー画像のURL(https)。なければ null
  cover_url: string | null;
  // 手元の状況と、手放した日(手元にあるときは null)
  status: BookStatus;
  released_on: string | null;
  // 買った日。自分で入れた日、なければ紐づけた取引の日付。どちらもなければ null
  purchased_on: string | null;
  transaction_id: string | null;
  created_at: string;
}

// ---- スキーマ(MCP の入力定義・API の検証・型を兼ねる) ----

const idField = z.string().min(1).max(100);
const isbnField = z
  .string({ error: "isbn は文字列で指定してください" })
  .trim()
  .transform((v, ctx) => {
    const n = normalizeIsbn(v);
    if (n === null) ctx.addIssue({ code: "custom", message: "ISBN が正しくありません(10桁か13桁。ハイフンは付けてもよい。チェックディジットも確かめます)" });
    return n ?? "";
  });
// カバー画像のURL。https のみ(ポート・認証情報つきは不可)。500文字まで。空文字は未指定扱い: 追加では NULL、更新では消去
export const coverUrlField = z
  .string({ error: "cover_url は文字列で指定してください" })
  .trim()
  .transform((v, ctx) => {
    if (v === "") return "";
    const u = parseHttpsUrl(v);
    if (u === null || u.length > MAX_COVER_URL_LENGTH) {
      ctx.addIssue({ code: "custom", message: `cover_url は https のURL(${MAX_COVER_URL_LENGTH}文字まで)で指定してください` });
      return "";
    }
    return u;
  });
// 空文字(空白だけを含む)は未指定扱い: 追加では NULL、更新では消去
const text = (max: number) => z.string().trim().max(max);

const ISBN_DESCRIPTION = "ISBN(10桁か13桁。ハイフンは付けてもよい)。チェックディジットを確かめ、13桁にそろえて保存する。ISBN かタイトルのどちらかは必須";

export const newBookSchema = z
  .strictObject({
    isbn: isbnField.optional().describe(ISBN_DESCRIPTION),
    title: text(MAX_TITLE_LENGTH).optional().describe(`本のタイトル(${MAX_TITLE_LENGTH}文字まで)。ISBN からネットで調べた結果を入れる。ISBN かタイトルのどちらかは必須`),
    author: text(MAX_AUTHOR_LENGTH).optional().describe(`著者名(${MAX_AUTHOR_LENGTH}文字まで)。任意`),
    series: text(MAX_SERIES_LENGTH).optional().describe(`シリーズ名・叢書名(${MAX_SERIES_LENGTH}文字まで)。任意。表記ゆれを避けるため、list_books の facets.series にある既存の名前に合わせる`),
    buyer: text(MAX_BUYER_LENGTH).optional().describe(`購入者(買った人。${MAX_BUYER_LENGTH}文字まで)。任意`),
    note: text(MAX_NOTE_LENGTH).optional().describe(`メモ(${MAX_NOTE_LENGTH}文字まで)。任意`),
    cover_url: coverUrlField.optional().describe("カバー画像のURL(https のみ。500文字まで)。任意。画像は保存せず、URLを参照して表示する。ネットで本を調べたときに分かれば入れる"),
    status: statusField.optional().describe(STATUS_DESCRIPTION),
    released_on: isoDate.optional().describe("手放した日(YYYY-MM-DD)。任意。status が owned のときは付けられない"),
    purchased_on: isoDate.optional().describe("買った日(YYYY-MM-DD)。任意。省略して transaction_id を付けると、その取引の日付が買った日になる"),
    transaction_id: idField.optional().describe("紐づけるレシートの取引 id(list_transactions や add_transactions の結果で分かる)。任意"),
  })
  .refine((v) => !!v.isbn || !!v.title, { message: "isbn か title のどちらかは必須です", path: ["isbn"] });
export type NewBook = z.infer<typeof newBookSchema>;

// 更新用。省略した項目は変えない。isbn 以外の任意の項目は null か空文字で消去できる
export const updateBookFieldsSchema = z.strictObject({
  id: idField.describe("更新する本の記録の id(list_books で分かる)。必須"),
  isbn: isbnField.nullable().optional().describe(`新しい ISBN。null で消去。${ISBN_DESCRIPTION}`),
  title: text(MAX_TITLE_LENGTH).nullable().optional().describe("新しいタイトル。null か空文字で消去。省略すると変えない"),
  author: text(MAX_AUTHOR_LENGTH).nullable().optional().describe("新しい著者名。null か空文字で消去"),
  series: text(MAX_SERIES_LENGTH).nullable().optional().describe("新しいシリーズ名。null か空文字で消去"),
  buyer: text(MAX_BUYER_LENGTH).nullable().optional().describe("新しい購入者。null か空文字で消去"),
  note: text(MAX_NOTE_LENGTH).nullable().optional().describe("新しいメモ。null か空文字で消去"),
  cover_url: coverUrlField.nullable().optional().describe("新しいカバー画像のURL(https)。null か空文字で消去"),
  status: statusField.optional().describe(`新しい手元の状況。${STATUS_DESCRIPTION}。owned に戻すと、手放した日は消える`),
  released_on: isoDate.nullable().optional().describe("新しい手放した日(YYYY-MM-DD)。null で消去。status が owned のときは付けられない"),
  purchased_on: isoDate.nullable().optional().describe("新しい買った日(YYYY-MM-DD)。null で消去(紐づけた取引の日付になる)"),
  transaction_id: idField.nullable().optional().describe("新しい紐づけ先の取引 id。null で紐づけを外す"),
});

export const deleteBookSchema = z.strictObject({ id: idField.describe("削除する本の記録の id(list_books で分かる)。必須") });

export const listBooksFieldsSchema = z.strictObject({
  q: z.string().trim().min(1).max(100).optional().describe("言葉で探す(タイトル・著者・シリーズ・購入者・メモ・ISBN のどれかに部分一致。空白で区切ると、すべてを含むものに絞る)"),
  series: z.string().trim().min(1).max(MAX_SERIES_LENGTH).optional().describe("このシリーズの本だけ(完全一致)"),
  author: z.string().trim().min(1).max(MAX_AUTHOR_LENGTH).optional().describe("この著者の本だけ(完全一致)"),
  buyer: z.string().trim().min(1).max(MAX_BUYER_LENGTH).optional().describe("この購入者の本だけ(完全一致)"),
  status: z.enum(["owned", "released", ...BOOK_STATUSES.filter((v) => v !== "owned")], { error: "status は owned / released / sold / given / donated / lost / discarded のいずれかで指定してください" }).optional().describe("手元の状況で絞る。owned=手元にある本だけ、released=手放した本すべて、ほかは個別の状況"),
  isbn: isbnField.optional().describe("この ISBN の本だけ(10桁でも13桁でもよい)。同じ本を買っていないか確かめるのに使う"),
  from: isoDate.optional().describe("この日以降に買った本(YYYY-MM-DD)"),
  to: isoDate.optional().describe("この日以前に買った本(YYYY-MM-DD)"),
  transaction_id: idField.optional().describe("この取引に紐づく本だけ"),
  unlinked: z.boolean().optional().describe("true で、レシートに紐づいていない本だけ"),
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT).describe(`records の最大件数(既定${DEFAULT_LIST_LIMIT}、最大${MAX_LIST_LIMIT})。count は絞り込みに合う全件で数える`),
  offset: z.number().int().min(0).max(100_000).default(0).describe("先頭から飛ばす件数(ページ送り用。例: limit 24 の2ページ目は offset 24)"),
});

// ---- 保存・取得 ----

const VIEW_SELECT = `SELECT b.id, b.isbn, b.title, b.author, b.series, b.buyer, b.note, b.cover_url, b.status, b.released_on, COALESCE(b.purchased_on, t.date) AS purchased_on, b.transaction_id, b.created_at
  FROM books b LEFT JOIN transactions t ON t.id = b.transaction_id`;

export type BookResult = { ok: true; book: BookView; message: string } | { ok: false; errors: FieldError[] };
export type DeleteBookResult = { ok: true; deleted: BookView; message: string } | { ok: false; errors: FieldError[] };
export type ListBooksResult =
  | {
      ok: true;
      // 絞り込みに合う全件の数(records は limit まで)
      count: number;
      records: BookView[];
      // 絞り込みの候補(全部の本から。登録の表記をそろえるのにも使う)
      facets: { series: string[]; authors: string[]; buyers: string[] };
      truncated: boolean;
      message: string;
    }
  | { ok: false; errors: FieldError[] };

const notFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: 「${id.slice(0, 64)}」という本の記録はありません。list_books で id を確かめてください` }],
});

const label = (b: Pick<BookView, "title" | "isbn" | "author">) => `${b.title ?? `ISBN ${b.isbn}`}${b.author ? `(${b.author})` : ""}`;

export async function getBook(db: D1Database, id: string): Promise<BookView | null> {
  return db.prepare(`${VIEW_SELECT} WHERE b.id = ?`).bind(id).first<BookView>();
}

export async function addBook(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<BookResult> {
  const parsed = newBookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const errors = await checkRefs(db, m);
  if (errors.length > 0) return { ok: false, errors };

  const status = m.status ?? "owned";
  if (status === "owned" && m.released_on) return { ok: false, errors: [{ field: "released_on", message: "released_on: 手元にある本には、手放した日は付けられません。status を変えてください" }] };
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO books (id, isbn, title, author, series, buyer, note, cover_url, status, released_on, purchased_on, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, m.isbn || null, m.title || null, m.author || null, m.series || null, m.buyer || null, m.note || null, m.cover_url || null, status, m.released_on ?? null, m.purchased_on ?? null, m.transaction_id ?? null, (options.now ?? new Date()).toISOString())
    .run();
  const book = (await getBook(db, id))!;
  // 同じ ISBN の本が、すでにあるときは知らせる(登録は止めない。同じ本を2冊買うこともある)
  let dup = "";
  if (book.isbn) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM books WHERE isbn = ? AND id <> ?").bind(book.isbn, id).first<{ n: number }>();
    if ((n?.n ?? 0) > 0) dup = `。同じ ISBN の本が、ほかに${n!.n}件あります(同じ本を買い直していないか確かめてください)`;
  }
  return { ok: true, book, message: `本の記録を登録しました: ${label(book)}${dup}` };
}

export async function updateBook(db: D1Database, input: unknown): Promise<BookResult> {
  const parsed = updateBookFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, ...changes } = parsed.data;

  const current = await getBook(db, id);
  if (!current) return notFound(id);
  if (Object.values(changes).every((v) => v === undefined)) {
    return { ok: false, errors: [{ field: "input", message: "input: 更新する項目(isbn / title / author / series / buyer / note / cover_url / status / released_on / purchased_on / transaction_id)を1つ以上指定してください" }] };
  }
  if (changes.transaction_id) {
    const errors = await checkRefs(db, { transaction_id: changes.transaction_id });
    if (errors.length > 0) return { ok: false, errors };
  }

  // 買った日は、取引の日付を借りている場合があるので、元の列の値(自分で入れた日)を読んで保つ
  const raw = await db.prepare("SELECT purchased_on FROM books WHERE id = ?").bind(id).first<{ purchased_on: string | null }>();
  const pick = <T>(next: T | null | undefined, cur: T | null): T | null => (next === undefined ? cur : next === null || next === "" ? null : next);
  const next = {
    isbn: pick(changes.isbn, current.isbn),
    title: pick(changes.title, current.title),
    author: pick(changes.author, current.author),
    series: pick(changes.series, current.series),
    buyer: pick(changes.buyer, current.buyer),
    note: pick(changes.note, current.note),
    cover_url: pick(changes.cover_url, current.cover_url),
    status: changes.status ?? current.status,
    released_on: changes.status === "owned" ? null : pick(changes.released_on, current.released_on),
    purchased_on: pick(changes.purchased_on, raw?.purchased_on ?? null),
    transaction_id: pick(changes.transaction_id, current.transaction_id),
  };
  if (next.status === "owned" && changes.released_on) return { ok: false, errors: [{ field: "released_on", message: "released_on: 手元にある本には、手放した日は付けられません。status を変えてください" }] };
  if (!next.isbn && !next.title) return { ok: false, errors: [{ field: "title", message: "title: isbn と title の両方を消すことはできません" }] };
  await db
    .prepare("UPDATE books SET isbn = ?, title = ?, author = ?, series = ?, buyer = ?, note = ?, cover_url = ?, status = ?, released_on = ?, purchased_on = ?, transaction_id = ? WHERE id = ?")
    .bind(next.isbn, next.title, next.author, next.series, next.buyer, next.note, next.cover_url, next.status, next.released_on, next.purchased_on, next.transaction_id, id)
    .run();
  const book = (await getBook(db, id))!;
  return { ok: true, book, message: `本の記録を更新しました: ${label(book)}` };
}

export async function deleteBook(db: D1Database, input: unknown): Promise<DeleteBookResult> {
  const parsed = deleteBookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const current = await getBook(db, id);
  if (!current) return notFound(id);
  await db.prepare("DELETE FROM books WHERE id = ?").bind(id).run();
  return { ok: true, deleted: current, message: `本の記録を削除しました: ${label(current)}` };
}

// 絞り込み(すべて AND)。並びは買った日の新しい順(日がない本は最後、同じ日は登録の新しい順)
export async function listBooks(db: D1Database, input: unknown): Promise<ListBooksResult> {
  const parsed = listBooksFieldsSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  if (m.from && m.to && m.from > m.to) return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };

  const where: string[] = [];
  const binds: (string | number)[] = [];
  const add = (sql: string, value: string | number | undefined) => {
    if (value === undefined) return;
    where.push(sql);
    binds.push(value);
  };
  // 言葉は空白で区切り、すべてを含むものに絞る(各語は、いずれかの列に部分一致)
  for (const word of (m.q ?? "").split(/\s+/).filter(Boolean)) {
    const like = `%${escapeLike(word)}%`;
    where.push("(b.title LIKE ? ESCAPE '\\' OR b.author LIKE ? ESCAPE '\\' OR b.series LIKE ? ESCAPE '\\' OR b.buyer LIKE ? ESCAPE '\\' OR b.note LIKE ? ESCAPE '\\' OR b.isbn LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like, like, like);
  }
  add("b.series = ?", m.series);
  add("b.author = ?", m.author);
  add("b.buyer = ?", m.buyer);
  if (m.status === "owned") where.push("b.status = 'owned'");
  else if (m.status === "released") where.push("b.status <> 'owned'");
  else add("b.status = ?", m.status);
  add("b.isbn = ?", m.isbn || undefined);
  add("COALESCE(b.purchased_on, t.date) >= ?", m.from);
  add("COALESCE(b.purchased_on, t.date) <= ?", m.to);
  add("b.transaction_id = ?", m.transaction_id);
  if (m.unlinked) where.push("b.transaction_id IS NULL");
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const from = "FROM books b LEFT JOIN transactions t ON t.id = b.transaction_id";

  const facet = async (column: "series" | "author" | "buyer"): Promise<string[]> => {
    const { results } = await db.prepare(`SELECT DISTINCT ${column} AS v FROM books WHERE ${column} IS NOT NULL ORDER BY ${column} LIMIT ?`).bind(MAX_FACET_ROWS).all<{ v: string }>();
    return results.map((r) => r.v);
  };
  const [rows, total, series, authors, buyers] = await Promise.all([
    db
      .prepare(`${VIEW_SELECT} ${clause} ORDER BY (COALESCE(b.purchased_on, t.date) IS NULL), COALESCE(b.purchased_on, t.date) DESC, b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`)
      .bind(...binds, m.limit, m.offset)
      .all<BookView>(),
    db.prepare(`SELECT COUNT(*) AS n ${from} ${clause}`).bind(...binds).first<{ n: number }>(),
    facet("series"),
    facet("author"),
    facet("buyer"),
  ]);
  const count = total?.n ?? 0;
  const truncated = m.offset + rows.results.length < count;
  return {
    ok: true,
    count,
    records: rows.results,
    facets: { series, authors, buyers },
    truncated,
    message: count === 0 ? "該当する本の記録はありません" : rows.results.length === 0 ? `${count}冊の本の記録がありますが、この範囲(offset ${m.offset})にはありません` : `${count}冊の本の記録があります${truncated || m.offset > 0 ? `(買った日の新しい順に、${m.offset + 1}〜${m.offset + rows.results.length}冊目を返しました)` : ""}`,
  };
}
