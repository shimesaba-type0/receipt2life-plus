import { z } from "zod";
import { checkRefs, onDay } from "./photos";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import { TitleFetchError, type TitleFetcher } from "./link-titles";
import type { CoreOptions } from "./transactions";

// 外部リンク(links)。Xの投稿・YouTubeの動画・Instagramの投稿・サイトを問わない https のページのURLを、日付・取引・出来事に付ける。
// URLの形だけを検証・正規化する。タイトルは、登録のときだけ公式の oEmbed から取得する(src/core/link-titles.ts。YouTube と X だけ)。
// それ以外(Instagram・ウェブ)はサーバーから取りに行かない。AI が読んだタイトルと説明文を、MCP 経由で渡してもらう。

export const LINK_KINDS = ["x", "youtube", "instagram", "web"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const MAX_URL_LENGTH = 2048;
export const MAX_DESCRIPTION_LENGTH = 500;

export interface LinkView {
  id: string;
  url: string;
  kind: LinkKind;
  title: string | null;
  // 説明文(AI が読んだ要約など、任意)
  description: string | null;
  date: string | null;
  transaction_id: string | null;
  event_id: string | null;
  created_at: string;
}

// ホストは完全一致で判定する(`youtube.com.evil.example` などの偽装を通さない)
const X_HOSTS = new Set(["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

const SUPPORTED_HINT =
  "対応しているのは、Xの投稿(https://x.com/<ユーザー名>/status/<数字>、twitter.com も可)と、YouTubeの動画(https://www.youtube.com/watch?v=<動画ID>、https://youtu.be/<動画ID>、/shorts/<動画ID>、/live/<動画ID>、再生リスト /playlist?list=<ID>)と、Instagramの投稿・リール(https://www.instagram.com/p/<コード>/、/reel/<コード>/。プロフィール /<ユーザー名>/ も可)と、それ以外のサイトの https のページです";

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
  if (INSTAGRAM_HOSTS.has(host)) return parseInstagram(host, u);
  return parseWeb(host, u);
}

// サイトを問わないリンク。https のページだけ。内部向けのホスト(localhost・IPアドレス・ドットの無い名前)は受けない
const WEB_TRACKING = new Set(["fbclid", "gclid", "gbraid", "wbraid", "msclkid", "yclid", "dclid", "mc_cid", "mc_eid", "igshid", "twclid", "_ga", "ref_src"]);
const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

function parseWeb(host: string, u: URL): ParsedLinkUrl {
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host)) return bad("url のホストはドメイン名にしてください(IPアドレスは使えません)");
  if (!host.includes(".") || host.endsWith(".") || host === "localhost" || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return bad(`url のサイト「${host.slice(0, 80)}」は公開されたドメイン名ではありません`);
  }
  // フラグメントと追跡用のクエリ(utm_* など)を消す。そのほかのクエリは、順序もそのまま残す(ページを決めるものがあるため)
  const params = [...u.searchParams.entries()].filter(([k]) => !k.startsWith("utm_") && !WEB_TRACKING.has(k));
  return { ok: true, url: build(host, u.pathname, params), kind: "web" };
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

const INSTAGRAM_USER = /^[A-Za-z0-9._]{1,30}$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,40}$/;
const INSTAGRAM_RESERVED_PROFILES = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about", "legal", "web", "developer", "directory", "emails", "challenge", "oauth", "privacy"]);

// Instagram: 投稿 /p/<コード>、リール /reel/<コード>(/reels/<コード>)、/tv/<コード>(ユーザー名つき /<ユーザー名>/p/<コード> も可)、プロフィール /<ユーザー名>。
// クエリ(igsh・img_index・utm_* など)はすべて消す。ストーリー(/stories/…。24時間で消える)は対象外
function parseInstagram(host: string, u: URL): ParsedLinkUrl {
  const path = u.pathname.replace(/\/$/, "");
  const post = /^(?:\/([^/]+))?\/(p|reel|reels|tv)\/([^/]+)$/.exec(path);
  if (post) {
    if (post[1] !== undefined && !INSTAGRAM_USER.test(post[1])) return bad("url のユーザー名の形が正しくありません");
    if (!INSTAGRAM_CODE.test(post[3]!)) return bad("url の投稿のコードの形が正しくありません");
    return { ok: true, url: `https://${host}${path}/`, kind: "instagram" };
  }
  const profile = /^\/([^/]+)$/.exec(path);
  if (profile) {
    const name = profile[1]!;
    if (!INSTAGRAM_USER.test(name) || INSTAGRAM_RESERVED_PROFILES.has(name.toLowerCase())) return bad("url がユーザーのプロフィールの形ではありません");
    return { ok: true, url: `https://${host}${path}/`, kind: "instagram" };
  }
  return bad("url はInstagramの投稿(/p/<コード>)・リール(/reel/<コード>)またはプロフィール(/<ユーザー名>)の形にしてください");
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
const descriptionField = z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH);

const TARGET_MESSAGE = "date、transaction_id、event_id のうち1つ以上を指定してください";
const anyTarget = (m: { date?: string; transaction_id?: string; event_id?: string }) => Boolean(m.date || m.transaction_id || m.event_id);

// MCP の入力定義(.shape)に使う。「どれか1つ以上」の検証は newLinkSchema で行う
export const linkFieldsSchema = z.strictObject({
  url: urlField.describe("リンクのURL。https のページならサイトは問わない。Xの投稿・YouTubeの動画・Instagramの投稿は専用に扱う。必須"),
  title: titleField.optional().describe("リンクの表題(200文字まで)。YouTube と X 以外は、サーバーがページを読みに行かないので、ページを読んだ AI が付ける"),
  description: descriptionField.optional().describe("リンクの説明文(500文字まで、任意)。ページの内容の要約など"),
  date: isoDate.optional().describe("リンクを紐づける日付(YYYY-MM-DD)"),
  transaction_id: idField.optional().describe("リンクを紐づける取引の id(list_transactions や add_transactions の結果で分かる)"),
  event_id: idField.optional().describe("リンクを紐づける出来事の id(list_events で分かる)"),
});

export const newLinkSchema = linkFieldsSchema.refine(anyTarget, { message: TARGET_MESSAGE, path: ["date"] });
export type NewLink = z.infer<typeof newLinkSchema>;

// title・description は null で消去できる。どちらか1つ以上を渡す
export const updateLinkFieldsSchema = z.strictObject({
  id: idField,
  title: titleField.nullable().optional().describe("新しい表題。null で消去"),
  description: descriptionField.nullable().optional().describe("新しい説明文。null で消去"),
});
export const updateLinkSchema = updateLinkFieldsSchema.refine((m) => m.title !== undefined || m.description !== undefined, {
  message: "title か description の少なくとも1つを指定してください",
  path: ["title"],
});

export const deleteLinkSchema = z.strictObject({ id: idField.describe("削除するリンクの id(list_links で分かる)") });

export const listLinksFieldsSchema = z.strictObject({
  date: isoDate.optional().describe("この日のリンク(YYYY-MM-DD)。その日の取引・その日と重なる出来事に付いたリンクも含む"),
  transaction_id: idField.optional().describe("この取引に付いたリンク"),
  event_id: idField.optional().describe("この出来事に付いたリンク"),
});
export const listLinksSchema = listLinksFieldsSchema.refine(anyTarget, { message: TARGET_MESSAGE, path: ["date"] });

// ---- 保存 ----

const COLUMNS = "id, url, kind, title, description, date, transaction_id, event_id, created_at";

export type LinkResult =
  | { ok: true; link: LinkView; duplicate: boolean; message: string }
  | { ok: false; errors: FieldError[] };
export type DeleteLinkResult = { ok: true; deleted: LinkView; message: string } | { ok: false; errors: FieldError[] };
export type ListLinksResult = { ok: true; count: number; links: LinkView[]; message: string } | { ok: false; errors: FieldError[] };

const notFound = (id: string): { ok: false; errors: FieldError[] } => ({
  ok: false,
  errors: [{ field: "id", message: `id: 「${id.slice(0, 64)}」というリンクはありません。list_links で id を確かめてください` }],
});

const kindLabel = (kind: LinkKind) => ({ x: "X", youtube: "YouTube", instagram: "Instagram", web: "ウェブ" })[kind];

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

export interface AddLinkOptions extends CoreOptions {
  // 表題が無いときに、タイトルを取りに行く(oEmbed。src/core/link-titles.ts)。省略すると取りに行かない(テスト・インポート)
  fetchTitle?: TitleFetcher;
}

export async function addLink(db: D1Database, input: unknown, options: AddLinkOptions = {}): Promise<LinkResult> {
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

  // 表題が無ければ取りに行く。取れなければ表題なしで登録する(登録は失敗させない)
  let title = m.title ?? null;
  if (title === null && options.fetchTitle && url.kind !== "instagram" && url.kind !== "web") {
    title = await options.fetchTitle(url.kind, url.url).catch((e: unknown) => {
      console.log(`link title: ${url.kind} ${e instanceof TitleFetchError ? e.reason : "取得に失敗しました"}`);
      return null;
    });
  }
  const link: LinkView = {
    id: crypto.randomUUID(),
    url: url.url,
    kind: url.kind,
    title,
    description: m.description ?? null,
    ...target,
    created_at: (options.now ?? new Date()).toISOString(),
  };
  await db
    .prepare(`INSERT INTO links (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(link.id, link.url, link.kind, link.title, link.description, link.date, link.transaction_id, link.event_id, link.created_at)
    .run();
  return { ok: true, link, duplicate: false, message: `リンクを登録しました: ${kindLabel(link.kind)} ${link.url}` };
}

export async function updateLink(db: D1Database, input: unknown): Promise<LinkResult> {
  const parsed = updateLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const current = await db.prepare(`SELECT ${COLUMNS} FROM links WHERE id = ?`).bind(id).first<LinkView>();
  if (!current) return notFound(id);
  // 渡された項目だけ変える(渡さなかった項目はそのまま)
  const title = parsed.data.title === undefined ? current.title : parsed.data.title;
  const description = parsed.data.description === undefined ? current.description : parsed.data.description;
  await db.prepare("UPDATE links SET title = ?, description = ? WHERE id = ?").bind(title, description, id).run();
  const link = { ...current, title, description };
  return { ok: true, link, duplicate: false, message: `リンクを更新しました: ${link.url}` };
}

// 登録済みのリンクのタイトルを、取りに行って付け直す(タイトルが無いリンク用)。取れなければエラー(いまのタイトルは変えない)
export async function refreshLinkTitle(db: D1Database, input: unknown, fetchTitle: TitleFetcher): Promise<LinkResult> {
  const parsed = deleteLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { id } = parsed.data;
  const current = await db.prepare(`SELECT ${COLUMNS} FROM links WHERE id = ?`).bind(id).first<LinkView>();
  if (!current) return notFound(id);
  if (current.kind === "instagram") {
    return { ok: false, errors: [{ field: "title", message: "title: Instagram のタイトルは自動では取得できません(公式の取得方法は事前の登録が必要なため)。「タイトルを編集」で手入力してください" }] };
  }
  if (current.kind === "web") {
    return { ok: false, errors: [{ field: "title", message: "title: ウェブのリンクのタイトルは、サーバーからは取得しません。「タイトルを編集」で手入力するか、AI に update_link で付けてもらってください" }] };
  }
  let title: string | null = null;
  let reason = "タイトルが見つかりませんでした";
  try {
    title = await fetchTitle(current.kind, current.url);
  } catch (e) {
    if (e instanceof TitleFetchError) reason = e.reason;
    else reason = "取得に失敗しました";
    // どこで失敗したかを、ダッシュボードのログに残す(リンクのURLは書かない)
    console.log(`link title: ${current.kind} ${reason}`);
  }
  if (title === null) {
    return { ok: false, errors: [{ field: "title", message: `title: タイトルを取得できませんでした(${reason})。「タイトルを編集」で手入力できます` }] };
  }
  await db.prepare("UPDATE links SET title = ? WHERE id = ?").bind(title, id).run();
  const link = { ...current, title };
  return { ok: true, link, duplicate: false, message: `タイトルを取得しました: ${title}` };
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
    .prepare(`SELECT l.id, l.url, l.kind, l.title, l.description, l.date, l.transaction_id, l.event_id, l.created_at FROM links l WHERE ${onDay("l", "?")} ORDER BY l.created_at, l.id`)
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
      `SELECT l.id, l.url, l.kind, l.title, l.description, l.date, l.transaction_id, l.event_id, l.created_at FROM links l
       WHERE ${conditions.join(" OR ")} ORDER BY l.created_at, l.id`,
    )
    .bind(...binds)
    .all<LinkView>();
  return { ok: true, count: results.length, links: results, message: results.length === 0 ? "該当するリンクはありません" : `${results.length}件のリンクがあります` };
}
