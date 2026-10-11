import { z } from "zod";
import { checkRefs, onDay } from "./photos";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import type { CoreOptions } from "./transactions";

// 外部リンク(links)。Xの投稿・YouTubeの動画のURLを、日付・取引・出来事に付ける。
// Worker から外のサイトへは取りに行かない(タイトル取得も埋め込みもしない)。URLの形だけを検証・正規化する。

export const LINK_KINDS = ["x", "youtube"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const MAX_URL_LENGTH = 2048;

export interface LinkView {
  id: string;
  url: string;
  kind: LinkKind;
  title: string | null;
  date: string | null;
  transaction_id: string | null;
  event_id: string | null;
  created_at: string;
}

// ホストは完全一致で判定する(`youtube.com.evil.example` などの偽装を通さない)
const X_HOSTS = new Set(["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

const SUPPORTED_HINT =
  "対応しているのは、Xの投稿(https://x.com/<ユーザー名>/status/<数字>、twitter.com も可)と、YouTubeの動画(https://www.youtube.com/watch?v=<動画ID>、https://youtu.be/<動画ID>、/shorts/<動画ID>、/live/<動画ID>、再生リスト /playlist?list=<ID>)です";

const bad = (reason: string) => ({ ok: false as const, message: `${reason}。${SUPPORTED_HINT}` });

export type ParsedLinkUrl = { ok: true; url: string; kind: LinkKind } | { ok: false; message: string };

const X_RESERVED_PROFILES = new Set(["home", "explore", "search", "settings", "notifications", "messages", "login", "i", "intent", "share", "compose", "hashtag"]);
const X_USER = /^[A-Za-z0-9_]{1,15}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
// 開始位置: 90 / 90s / 1h2m3s
const START_TIME = /^(?=.)(\d{1,6}|(\d{1,3}h)?(\d{1,3}m)?(\d{1,6}s)?)$/;

const isTracking = (key: string) => key.startsWith("utm_") || key === "si" || key === "fbclid" || key === "feature";

function build(host: string, path: string, params: [string, string][]): string {
  const search = new URLSearchParams(params).toString();
  return `https://${host}${path}${search ? `?${search}` : ""}`;
}

/**
 * URLを検証して正規化する。https のみ、userinfo・独自ポート禁止、ホストは許可リストと完全一致。
 * 正規化: フラグメント削除、追跡用クエリ削除、ホストは小文字(入力のホストのまま。x.com / youtube.com に寄せない)
 */
export function parseLinkUrl(input: string): ParsedLinkUrl {
  const raw = input.trim();
  if (raw === "") return bad("url が空です");
  if (raw.length > MAX_URL_LENGTH) return bad(`url が長すぎます(${MAX_URL_LENGTH}文字まで)`);
  // 空白・制御文字・ASCII以外(全角のホスト名など)は受けない
  if (/[^\x21-\x7e]/.test(raw)) return bad("url に空白・制御文字・日本語などのASCII以外の文字は使えません");

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return bad("url がURLとして読めません");
  }
  if (u.protocol !== "https:") return bad(`url は https:// で始まるURLだけ使えます(${u.protocol.replace(/[^a-z]/gi, "") || "不明"}: は不可)`);
  if (u.username !== "" || u.password !== "") return bad("url にユーザー名・パスワード(user:pass@)は含められません");
  if (u.port !== "") return bad("url のポート番号は指定できません(省略するか 443 のみ)");

  const host = u.hostname;
  if (X_HOSTS.has(host)) return parseX(host, u);
  if (YOUTUBE_HOSTS.has(host)) return parseYouTube(host, u);
  return bad(`url のサイト「${host.slice(0, 80)}」には対応していません`);
}

function parseX(host: string, u: URL): ParsedLinkUrl {
  const path = u.pathname.replace(/\/$/, "");
  const post = /^\/([^/]+)\/status\/(\d{1,25})$/.exec(path);
  const profile = /^\/([^/]+)$/.exec(path);
  if (post) {
    if (!X_USER.test(post[1]!)) return bad("url のユーザー名の形が正しくありません");
  } else if (profile) {
    const name = profile[1]!;
    if (!X_USER.test(name) || X_RESERVED_PROFILES.has(name.toLowerCase())) return bad("url がユーザーのプロフィールの形ではありません");
  } else {
    return bad("url はXの投稿(/<ユーザー名>/status/<数字>)またはユーザーのプロフィール(/<ユーザー名>)の形にしてください");
  }
  // 追跡用(utm_* / si / fbclid / feature)と、共有リンクの s / t を消す
  const params = [...u.searchParams.entries()].filter(([k]) => !isTracking(k) && k !== "s" && k !== "t");
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { ok: true, url: build(host, path, params), kind: "x" };
}

function parseYouTube(host: string, u: URL): ParsedLinkUrl {
  const path = u.pathname.replace(/\/$/, "");
  const q = u.searchParams;
  const single = (key: string): string | null | "multiple" => {
    const all = q.getAll(key);
    return all.length === 0 ? null : all.length === 1 ? all[0]! : "multiple";
  };
  const params: [string, string][] = [];
  const addStart = (): string | null => {
    const t = single("t");
    if (t === null) return null;
    if (t === "multiple" || !START_TIME.test(t)) return "url の t(開始位置)は 90 や 1m30s の形にしてください";
    params.push(["t", t]);
    return null;
  };
  const addList = (required: boolean): string | null => {
    const list = single("list");
    if (list === null) return required ? "url に list=<再生リストID> が必要です" : null;
    if (list === "multiple" || !LIST_ID.test(list)) return "url の list(再生リストID)は英数字・_・- の10〜64文字にしてください";
    params.push(["list", list]);
    return null;
  };
  const done = (error: string | null, normalizedPath: string): ParsedLinkUrl =>
    error ? bad(error) : { ok: true, url: build(host, normalizedPath, params), kind: "youtube" };

  if (host === "youtu.be") {
    const m = /^\/([^/]+)$/.exec(path);
    if (!m || !VIDEO_ID.test(m[1]!)) return bad("url は youtu.be/<動画ID>(英数字・_・- の11文字)の形にしてください");
    return done(addStart() ?? addList(false), path);
  }
  if (path === "/watch") {
    const v = single("v");
    if (v === null || v === "multiple" || !VIDEO_ID.test(v)) return bad("url は watch?v=<動画ID>(英数字・_・- の11文字)の形にしてください");
    params.push(["v", v]);
    return done(addStart() ?? addList(false), path);
  }
  const m = /^\/(shorts|live)\/([^/]+)$/.exec(path);
  if (m) {
    if (!VIDEO_ID.test(m[2]!)) return bad(`url は /${m[1]}/<動画ID>(英数字・_・- の11文字)の形にしてください`);
    return done(addStart(), path);
  }
  if (path === "/playlist") return done(addList(true), path);
  return bad("url のパスがYouTubeの動画・再生リストの形ではありません");
}

// ---- スキーマ(MCP の入力定義・API の検証・型を兼ねる) ----

const idField = z.string().min(1).max(100);
const urlField = z
  .string()
  .max(MAX_URL_LENGTH, `${MAX_URL_LENGTH}文字までにしてください`)
  .superRefine((value, ctx) => {
    const parsed = parseLinkUrl(value);
    if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.message });
  });
const titleField = z.string().trim().min(1).max(200);

const TARGET_MESSAGE = "date、transaction_id、event_id のうち1つ以上を指定してください";
const anyTarget = (m: { date?: string; transaction_id?: string; event_id?: string }) => Boolean(m.date || m.transaction_id || m.event_id);

// MCP の入力定義(.shape)に使う。「どれか1つ以上」の検証は newLinkSchema で行う
export const linkFieldsSchema = z.strictObject({
  url: urlField.describe("リンクのURL。https のXの投稿(x.com / twitter.com の /<ユーザー名>/status/<数字>)かYouTubeの動画(youtube.com の watch?v= / shorts / live / playlist、youtu.be)。必須"),
  title: titleField.optional().describe("リンクの表題(200文字まで、任意)。URLの先のタイトルは取得しないので、必要なら自分で付ける"),
  date: isoDate.optional().describe("リンクを紐づける日付(YYYY-MM-DD)"),
  transaction_id: idField.optional().describe("リンクを紐づける取引の id(list_transactions や add_transactions の結果で分かる)"),
  event_id: idField.optional().describe("リンクを紐づける出来事の id(list_events で分かる)"),
});

export const newLinkSchema = linkFieldsSchema.refine(anyTarget, { message: TARGET_MESSAGE, path: ["date"] });
export type NewLink = z.infer<typeof newLinkSchema>;

// title は null で消去できる(必須の項目として渡す)
export const updateLinkSchema = z.strictObject({
  id: idField,
  title: titleField.nullable().describe("新しい表題。null で消去"),
});

export const deleteLinkSchema = z.strictObject({ id: idField.describe("削除するリンクの id(list_links で分かる)") });

export const listLinksFieldsSchema = z.strictObject({
  date: isoDate.optional().describe("この日のリンク(YYYY-MM-DD)。その日の取引・その日と重なる出来事に付いたリンクも含む"),
  transaction_id: idField.optional().describe("この取引に付いたリンク"),
  event_id: idField.optional().describe("この出来事に付いたリンク"),
});
export const listLinksSchema = listLinksFieldsSchema.refine(anyTarget, { message: TARGET_MESSAGE, path: ["date"] });

// ---- 保存 ----

const COLUMNS = "id, url, kind, title, date, transaction_id, event_id, created_at";

export type LinkResult =
  | { ok: true; link: LinkView; duplicate: boolean; message: string }
  | { ok: false; errors: FieldError[] };
export type DeleteLinkResult = { ok: true; deleted: LinkView; message: string } | { ok: false; errors: FieldError[] };
export type ListLinksResult = { ok: true; count: number; links: LinkView[]; message: string } | { ok: false; errors: FieldError[] };

const notFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: 「${id.slice(0, 64)}」というリンクはありません。list_links で id を確かめてください` }],
});

const kindLabel = (kind: LinkKind) => (kind === "x" ? "X" : "YouTube");

// 同じ紐づけ先(date / transaction_id / event_id が全部同じ)に、同じ正規化URLがあるか
export async function findDuplicateLink(
  db: D1Database,
  link: { url: string; date: string | null; transaction_id: string | null; event_id: string | null },
): Promise<LinkView | null> {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM links WHERE url = ? AND date IS ? AND transaction_id IS ? AND event_id IS ? ORDER BY created_at, id LIMIT 1`,
    )
    .bind(link.url, link.date, link.transaction_id, link.event_id)
    .first<LinkView>();
}

export async function addLink(db: D1Database, input: unknown, options: CoreOptions = {}): Promise<LinkResult> {
  const parsed = newLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const url = parseLinkUrl(m.url);
  if (!url.ok) return { ok: false, errors: [{ field: "url", message: `url: ${url.message}` }] };

  const errors = await checkRefs(db, m);
  if (errors.length > 0) return { ok: false, errors };

  const target = { date: m.date ?? null, transaction_id: m.transaction_id ?? null, event_id: m.event_id ?? null };
  const existing = await findDuplicateLink(db, { url: url.url, ...target });
  if (existing) {
    return { ok: true, link: existing, duplicate: true, message: `同じリンクが同じ紐づけ先に既にあるため、登録しませんでした(id: ${existing.id})` };
  }

  const link: LinkView = {
    id: crypto.randomUUID(),
    url: url.url,
    kind: url.kind,
    title: m.title ?? null,
    ...target,
    created_at: (options.now ?? new Date()).toISOString(),
  };
  await db
    .prepare(`INSERT INTO links (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(link.id, link.url, link.kind, link.title, link.date, link.transaction_id, link.event_id, link.created_at)
    .run();
  return { ok: true, link, duplicate: false, message: `リンクを登録しました: ${kindLabel(link.kind)} ${link.url}` };
}

export async function updateLink(db: D1Database, input: unknown): Promise<LinkResult> {
  const parsed = updateLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id, title } = parsed.data;
  const current = await db.prepare(`SELECT ${COLUMNS} FROM links WHERE id = ?`).bind(id).first<LinkView>();
  if (!current) return notFound(id);
  await db.prepare("UPDATE links SET title = ? WHERE id = ?").bind(title, id).run();
  const link = { ...current, title };
  return { ok: true, link, duplicate: false, message: `リンクの表題を更新しました: ${link.url}` };
}

export async function deleteLink(db: D1Database, input: unknown): Promise<DeleteLinkResult> {
  const parsed = deleteLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const current = await db.prepare(`SELECT ${COLUMNS} FROM links WHERE id = ?`).bind(id).first<LinkView>();
  if (!current) return notFound(id);
  await db.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
  return { ok: true, deleted: current, message: `リンクを削除しました: ${current.url}` };
}

// 日の詳細と同じ条件(日付そのもの、その日の取引、その日と重なる出来事)
export async function listLinksOnDay(db: D1Database, date: string): Promise<LinkView[]> {
  const { results } = await db
    .prepare(`SELECT l.id, l.url, l.kind, l.title, l.date, l.transaction_id, l.event_id, l.created_at FROM links l WHERE ${onDay("l", "?")} ORDER BY l.created_at, l.id`)
    .bind(date, date, date, date)
    .all<LinkView>();
  return results;
}

// 複数指定は和集合。date は日の詳細と同じ条件
export async function listLinks(db: D1Database, input: unknown): Promise<ListLinksResult> {
  const parsed = listLinksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const m = parsed.data;
  const errors = await checkRefs(db, m);
  if (errors.length > 0) return { ok: false, errors };

  const conditions: string[] = [];
  const binds: string[] = [];
  if (m.date) {
    conditions.push(onDay("l", "?"));
    binds.push(m.date, m.date, m.date, m.date);
  }
  if (m.transaction_id) {
    conditions.push("l.transaction_id = ?");
    binds.push(m.transaction_id);
  }
  if (m.event_id) {
    conditions.push("l.event_id = ?");
    binds.push(m.event_id);
  }
  const { results } = await db
    .prepare(
      `SELECT l.id, l.url, l.kind, l.title, l.date, l.transaction_id, l.event_id, l.created_at FROM links l
       WHERE ${conditions.join(" OR ")} ORDER BY l.created_at, l.id`,
    )
    .bind(...binds)
    .all<LinkView>();
  return { ok: true, count: results.length, links: results, message: results.length === 0 ? "該当するリンクはありません" : `${results.length}件のリンクがあります` };
}
