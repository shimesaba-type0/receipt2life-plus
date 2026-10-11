import type {
  ApiResult,
  CalendarData,
  CategoriesData,
  DayData,
  EventPatch,
  EventView,
  HomeData,
  LinkPatch,
  LinkView,
  NewEvent,
  NewLink,
  NewTransaction,
  PhotoMeta,
  PhotoView,
  TransactionPatch,
  TransactionView,
} from "../../src/api/contract";
import type { ImportResponse } from "./pages/backupLogic";

// 認証が切れている(Cloudflare Access のログインが必要)ことを表す
export class UnauthorizedError extends Error {
  constructor() {
    super("ログインが切れました。ページを読み込み直してください。");
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Access のログインへのリダイレクトは、fetch では通信エラーに見える
    throw new UnauthorizedError();
  }
  if (res.status === 401) throw new UnauthorizedError();
  try {
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { ok: false, errors: [{ field: "response", message: `サーバーの応答を読めませんでした(${res.status})` }] };
  }
}

export const photoUrl = (id: string): string => `/api/photos/${encodeURIComponent(id)}`;

export const getHome = () => request<HomeData>("GET", "/api/home");
export const getCalendar = (month?: string) => request<CalendarData>("GET", `/api/calendar${month ? `?month=${encodeURIComponent(month)}` : ""}`);
export const getDay = (date: string) => request<DayData>("GET", `/api/day/${encodeURIComponent(date)}`);
export const getCategories = () => request<CategoriesData>("GET", "/api/categories");

export const addTransactions = (transactions: NewTransaction[]) =>
  request<{ registered: TransactionView[]; skipped_duplicates: unknown[]; message: string }>("POST", "/api/transactions", { transactions });
export const updateTransaction = (id: string, patch: TransactionPatch) =>
  request<{ transaction: TransactionView; warnings: unknown[]; message: string }>("PATCH", `/api/transactions/${encodeURIComponent(id)}`, patch);
export const deleteTransaction = (id: string) => request<{ deleted: TransactionView; message: string }>("DELETE", `/api/transactions/${encodeURIComponent(id)}`);

export const addEvent = (event: NewEvent) => request<{ event: EventView; message: string }>("POST", "/api/events", event);
export const updateEvent = (id: string, patch: EventPatch) => request<{ event: EventView; message: string }>("PATCH", `/api/events/${encodeURIComponent(id)}`, patch);
export const deleteEvent = (id: string) => request<{ deleted: EventView; message: string }>("DELETE", `/api/events/${encodeURIComponent(id)}`);

// 写真は、ブラウザ側で長辺1600px程度に縮小してから送る(縮小は呼び出し側の責任)
export async function uploadPhoto(file: Blob, meta: PhotoMeta = {}): Promise<ApiResult<{ photo: PhotoView }>> {
  const form = new FormData();
  form.set("file", file);
  for (const [k, v] of Object.entries(meta)) if (v) form.set(k, v);
  let res: Response;
  try {
    res = await fetch("/api/photos", { method: "POST", credentials: "same-origin", body: form });
  } catch {
    throw new UnauthorizedError();
  }
  if (res.status === 401) throw new UnauthorizedError();
  try {
    return (await res.json()) as ApiResult<{ photo: PhotoView }>;
  } catch {
    return { ok: false, errors: [{ field: "response", message: `サーバーの応答を読めませんでした(${res.status})` }] };
  }
}
export const deletePhoto = (id: string) => request<{ deleted: PhotoView }>("DELETE", `/api/photos/${encodeURIComponent(id)}`);

// リンク(Xの投稿・YouTubeの動画)。duplicate が true のときは登録せず、既存のリンクが返る
export const addLink = (link: NewLink) => request<{ link: LinkView; duplicate: boolean; message: string }>("POST", "/api/links", link);
export const updateLink = (id: string, patch: LinkPatch) => request<{ link: LinkView; duplicate: false; message: string }>("PATCH", `/api/links/${encodeURIComponent(id)}`, patch);
export const deleteLink = (id: string) => request<{ deleted: LinkView; message: string }>("DELETE", `/api/links/${encodeURIComponent(id)}`);

// バックアップ(JSONL)の読み込み。本文はファイルの中身そのまま(JSONLかJSON配列)。上限の検査は呼び出し側で済ませる
// 全体のエラー(413 など)は ok: false で返る。行ごとの結果は ok: true の results に入る
export async function importBackup(file: Blob): Promise<ImportResponse & { status: number }> {
  let res: Response;
  try {
    res = await fetch("/import", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/x-ndjson" }, body: file });
  } catch {
    throw new UnauthorizedError();
  }
  if (res.status === 401) throw new UnauthorizedError();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: res.status, error: "" };
  }
  const b = (body ?? {}) as { ok?: boolean; error?: unknown; errors?: { message?: string }[] };
  if (res.ok && b.ok === true) return { ...(body as Extract<ImportResponse, { ok: true }>), status: res.status };
  const message = typeof b.error === "string" ? b.error : (b.errors?.[0]?.message ?? "");
  return { ok: false, status: res.status, error: message };
}
