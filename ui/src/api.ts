import type {
  AccountDeleted,
  AccountPatch,
  AccountsData,
  AccountView,
  ApiResult,
  CalendarData,
  CategoriesData,
  CategoryDeleted,
  CategoryPatch,
  CategoryView,
  DayData,
  DiscountsData,
  GroupRename,
  EventPatch,
  EventView,
  HomeData,
  LinkPatch,
  LinkView,
  MerchantsData,
  NewAccount,
  NewCategory,
  NewEvent,
  NewLink,
  DeletedSubscriptionData,
  NewSeatRecord,
  NewSubscription,
  NewTransaction,
  PhotoMeta,
  PhotoView,
  SeatRecordPatch,
  SeatRecordsData,
  VenuesData,
  SeatRecordSaved,
  SeatRecordView,
  SubscriptionData,
  SubscriptionPatch,
  CompareData,
  SearchData,
  ProductHistoryData,
  ExcludeDeleted,
  ProductGroupDeleted,
  ProductGroupSaved,
  ProductGroupsData,
  SearchChipDeleted,
  SearchHitType,
  SearchChipSaved,
  SearchChipsData,
  ExcludeSaved,
  ExcludesData,
  ProductsData,
  UsageData,
  SubscriptionsData,
  DeductionsData,
  TaxSummaryData,
  TaxWarning,
  TransactionDeleted,
  TransactionDetailData,
  TransactionPatch,
  TransactionView,
} from "../../src/api/contract";
import type { ImportResponse } from "./pages/backupLogic";
import { ShortCache } from "./api-cache";

// 認証が切れている(Cloudflare Access のログインが必要)ことを表す
export class UnauthorizedError extends Error {
  constructor() {
    super("ログインが切れました。ページを読み込み直してください。");
  }
}

// 成功した GET だけを短時間おぼえる。書き込みをしたら捨てる(api-cache.ts)
const getCache = new ShortCache<ApiResult<unknown>>();

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  if (method === "GET") {
    // 呼び出し側が結果を書き換えても、おぼえた値に影響しないよう、取り出すたびに複製する
    const value = await getCache.get(path, () => send<unknown>(method, path, body), (r) => r.ok);
    return structuredClone(value) as ApiResult<T>;
  }
  getCache.clear();
  try {
    return await send<T>(method, path, body);
  } finally {
    // 失敗(通信エラーなど)でも、サーバー側が書き換わっているかもしれないので、もう一度捨てる
    getCache.clear();
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
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
// 店名の候補。path は merchantsPath() が作る(同じ入力は短時間のキャッシュが効く)
export const getMerchants = (path: string) => request<MerchantsData>("GET", path);
export const getCategories = () => request<CategoriesData>("GET", "/api/categories");
// 税率別の税額(query は taxSummaryQuery で作る: from / to / group_by)
// 割引の集計(query: from / to / group_by)。ホームは getHome の discounts を使うので、いまは画面からは呼ばない
export const getDiscounts = (query: string) => request<DiscountsData>("GET", `/api/discounts${query ? `?${query}` : ""}`);
export const getDeductions = (query: string) => request<DeductionsData>("GET", `/api/deductions${query ? `?${query}` : ""}`);
// サブスク・保険などの固定費(別枠)。query は "active=true" のような絞り込み(省略可)
// 商品ごとの集計(一覧と、1つの商品の履歴)
export const getProducts = (query: string) => request<ProductsData>("GET", `/api/products?${query}`);
export const getSearchChips = () => request<SearchChipsData>("GET", "/api/search-chips");
export const addSearchChip = (chip: { label: string; q: string; type: SearchHitType | null }) => request<SearchChipSaved>("POST", "/api/search-chips", chip);
export const deleteSearchChip = (id: string) => request<SearchChipDeleted>("DELETE", `/api/search-chips/${encodeURIComponent(id)}`);
export const getProductExcludes = () => request<ExcludesData>("GET", "/api/product-excludes");
export const addProductExclude = (word: string) => request<ExcludeSaved>("POST", "/api/product-excludes", { word });
export const deleteProductExclude = (id: string) => request<ExcludeDeleted>("DELETE", `/api/product-excludes/${encodeURIComponent(id)}`);
export const getProductHistory = (product: string, by: "product" | "group" = "product") =>
  request<ProductHistoryData>("GET", `/api/products/history?product=${encodeURIComponent(product)}${by === "group" ? "&by=group" : ""}`);
export const getProductGroups = () => request<ProductGroupsData>("GET", "/api/product-groups");
export const createProductGroup = (g: { name: string; words: string[] }) => request<ProductGroupSaved>("POST", "/api/product-groups", g);
export const updateProductGroup = (id: string, g: { name: string; words: string[] }) => request<ProductGroupSaved>("PUT", `/api/product-groups/${encodeURIComponent(id)}`, g);
export const deleteProductGroup = (id: string) => request<ProductGroupDeleted>("DELETE", `/api/product-groups/${encodeURIComponent(id)}`);
// D1 の使用量(Cloudflare の分析 API から)
export const getUsage = () => request<UsageData>("GET", "/api/usage");
// 月の比較。path は compareApiPath() が作る
export const getCompare = (path: string) => request<CompareData>("GET", path);
// 記録の横断検索。path は searchPath() が作る
export const searchRecords = (path: string) => request<SearchData>("GET", path);
export const getSubscriptions = (query = "") => request<SubscriptionsData>("GET", `/api/subscriptions${query ? `?${query}` : ""}`);
export const addSubscription = (s: NewSubscription) => request<SubscriptionData>("POST", "/api/subscriptions", s);
export const updateSubscription = (id: string, patch: SubscriptionPatch) => request<SubscriptionData>("PATCH", `/api/subscriptions/${encodeURIComponent(id)}`, patch);
export const deleteSubscription = (id: string) => request<DeletedSubscriptionData>("DELETE", `/api/subscriptions/${encodeURIComponent(id)}`);
export const getTaxSummary = (query: string) => request<TaxSummaryData>("GET", `/api/tax-summary${query ? `?${query}` : ""}`);

// カテゴリの管理。name は日本語なので URL エンコードして送る
export const addCategory = (category: NewCategory) =>
  request<{ category: CategoryView; created_group: boolean; message: string }>("POST", "/api/categories", category);
export const updateCategory = (name: string, patch: CategoryPatch) =>
  request<{ category: CategoryView; created_group: boolean; message: string }>("PATCH", `/api/categories/${encodeURIComponent(name)}`, patch);
export const deleteCategory = (name: string, moveTo?: string) =>
  request<CategoryDeleted>("DELETE", `/api/categories/${encodeURIComponent(name)}${moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : ""}`);
export const renameCategoryGroup = (rename: GroupRename) =>
  request<{ group: string; previous: string; updated: number; merged: boolean; message: string }>("POST", "/api/category-groups/rename", rename);

// 口座(支払方法)の管理。categories と同じく name を URL エンコードして送る
export const getAccounts = () => request<AccountsData>("GET", "/api/accounts");
export const addAccount = (account: NewAccount) => request<{ account: AccountView; message: string }>("POST", "/api/accounts", account);
export const updateAccount = (name: string, patch: AccountPatch) =>
  request<{ account: AccountView; message: string }>("PATCH", `/api/accounts/${encodeURIComponent(name)}`, patch);
export const deleteAccount = (name: string, moveTo?: string) =>
  request<AccountDeleted>("DELETE", `/api/accounts/${encodeURIComponent(name)}${moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : ""}`);

export const addTransactions = (transactions: NewTransaction[]) =>
  request<{ registered: TransactionView[]; skipped_duplicates: unknown[]; tax_warnings: TaxWarning[]; message: string }>("POST", "/api/transactions", { transactions });
export const updateTransaction = (id: string, patch: TransactionPatch) =>
  request<{ transaction: TransactionView; warnings: unknown[]; tax_warnings: TaxWarning[]; message: string }>("PATCH", `/api/transactions/${encodeURIComponent(id)}`, patch);
export const getTransaction = (id: string) => request<TransactionDetailData>("GET", `/api/transactions/${encodeURIComponent(id)}`);
// 写真つきの取引は、deletePhotos: true(?delete_photos=1)でないと 400 で断られる
export const deleteTransaction = (id: string, opts: { deletePhotos?: boolean } = {}) =>
  request<TransactionDeleted>("DELETE", `/api/transactions/${encodeURIComponent(id)}${opts.deletePhotos ? "?delete_photos=1" : ""}`);

export const addEvent = (event: NewEvent) => request<{ event: EventView; message: string }>("POST", "/api/events", event);
export const updateEvent = (id: string, patch: EventPatch) => request<{ event: EventView; message: string }>("PATCH", `/api/events/${encodeURIComponent(id)}`, patch);
export const deleteEvent = (id: string) => request<{ deleted: EventView; message: string }>("DELETE", `/api/events/${encodeURIComponent(id)}`);

// 写真は、ブラウザ側で長辺1600px程度に縮小してから送る(縮小は呼び出し側の責任)
export async function uploadPhoto(file: Blob, meta: PhotoMeta = {}): Promise<ApiResult<{ photo: PhotoView }>> {
  const form = new FormData();
  form.set("file", file);
  for (const [k, v] of Object.entries(meta)) if (v) form.set(k, v);
  getCache.clear();
  let res: Response;
  try {
    res = await fetch("/api/photos", { method: "POST", credentials: "same-origin", body: form });
  } catch {
    throw new UnauthorizedError();
  } finally {
    getCache.clear();
  }
  if (res.status === 401) throw new UnauthorizedError();
  try {
    return (await res.json()) as ApiResult<{ photo: PhotoView }>;
  } catch {
    return { ok: false, errors: [{ field: "response", message: `サーバーの応答を読めませんでした(${res.status})` }] };
  }
}
export const deletePhoto = (id: string) => request<{ deleted: PhotoView }>("DELETE", `/api/photos/${encodeURIComponent(id)}`);

// リンク(Xの投稿・YouTubeの動画・Instagramの投稿)。duplicate が true のときは登録せず、既存のリンクが返る
export const addLink = (link: NewLink) => request<{ link: LinkView; duplicate: boolean; message: string }>("POST", "/api/links", link);
export const updateLink = (id: string, patch: LinkPatch) => request<{ link: LinkView; duplicate: false; message: string }>("PATCH", `/api/links/${encodeURIComponent(id)}`, patch);
// タイトルが無いリンクのタイトルを、サーバーが取りに行って付ける(YouTube・X の oEmbed)
export const fetchLinkTitle = (id: string) => request<{ link: LinkView; duplicate: false; message: string }>("POST", `/api/links/${encodeURIComponent(id)}/title`);
export const deleteLink = (id: string) => request<{ deleted: LinkView; message: string }>("DELETE", `/api/links/${encodeURIComponent(id)}`);

// 座席の記録(映画館などの席の評価)。getSeatRecords は絞り込み(date / venue / limit など)つきの一覧と、会場・スクリーン・座席ごとの集計
export function getSeatRecords(filter: { date?: string; title?: string; venue?: string; screen?: string; seat?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return request<SeatRecordsData>("GET", `/api/seat-records${qs ? `?${qs}` : ""}`);
}
export const addSeatRecord = (record: NewSeatRecord) => request<SeatRecordSaved>("POST", "/api/seat-records", record);
export const updateSeatRecord = (id: string, patch: SeatRecordPatch) => request<SeatRecordSaved>("PATCH", `/api/seat-records/${encodeURIComponent(id)}`, patch);
// 会場とスクリーンの一覧(フォームの候補に使う)
export const getVenues = () => request<VenuesData>("GET", "/api/venues");
export const deleteSeatRecord = (id: string) => request<{ deleted: SeatRecordView; message: string }>("DELETE", `/api/seat-records/${encodeURIComponent(id)}`);

// バックアップ(JSONL)の読み込み。本文はファイルの中身そのまま(JSONLかJSON配列)。上限の検査は呼び出し側で済ませる
// 全体のエラー(413 など)は ok: false で返る。行ごとの結果は ok: true の results に入る
export async function importBackup(file: Blob): Promise<ImportResponse & { status: number }> {
  getCache.clear();
  let res: Response;
  try {
    res = await fetch("/import", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/x-ndjson" }, body: file });
  } catch {
    throw new UnauthorizedError();
  } finally {
    getCache.clear();
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

// ---- 写真のバックアップ(ZIP) ----
// 書き出し(JSONL)の全文。写真の一覧(attachment の行)を取るのに使う
export async function fetchExportText(): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/export", { credentials: "same-origin" });
  } catch {
    throw new UnauthorizedError();
  }
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`書き出しに失敗しました(${res.status})`);
  return res.text();
}

// 写真の画像を1枚取り出す(失敗は、理由つきで返す)
export async function fetchPhotoBytes(id: string): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/photos/${encodeURIComponent(id)}`, { credentials: "same-origin" });
  } catch {
    throw new UnauthorizedError();
  }
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) return { ok: false, reason: res.status === 404 ? "画像の実体が見つかりません" : `取り出せませんでした(${res.status})` };
  return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
}

// 写真の実体を戻す(先に、バックアップ(JSONL)を読み込んでおく)
export async function putPhotoBytes(id: string, bytes: Uint8Array): Promise<{ ok: true; status: "restored" | "exists" } | { ok: false; status: number; error: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/photos/${encodeURIComponent(id)}/restore`, { method: "PUT", credentials: "same-origin", body: bytes.slice().buffer as ArrayBuffer });
  } catch {
    return { ok: false, status: 0, error: "通信に失敗しました" };
  }
  if (res.status === 401) throw new UnauthorizedError();
  let body: { ok?: boolean; status?: string; errors?: { message?: string }[] } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // 本文が読めなくても、状態コードで判断する
  }
  if (res.ok && body.ok === true && (body.status === "restored" || body.status === "exists")) return { ok: true, status: body.status };
  return { ok: false, status: res.status, error: body.errors?.[0]?.message ?? "" };
}
