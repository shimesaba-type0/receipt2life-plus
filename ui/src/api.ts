import type {
  ApiResult,
  CalendarData,
  CategoriesData,
  DayData,
  EventPatch,
  EventView,
  HomeData,
  NewEvent,
  NewTransaction,
  PhotoMeta,
  PhotoView,
  TransactionPatch,
  TransactionView,
} from "../../src/api/contract";

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
