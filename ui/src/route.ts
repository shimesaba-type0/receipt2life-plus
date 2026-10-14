// ルーティングの純粋な部分(DOMに触れない。テストする)
import type { SearchHitType } from "../../src/api/contract";

const SEARCH_TYPES: readonly string[] = ["transaction", "event", "seat_record", "link", "photo"];
export type Route =
  | { name: "home" }
  | { name: "calendar"; month: string | null }
  | { name: "day"; date: string }
  | { name: "transaction"; id: string }
  | { name: "photosAdd"; target: PhotosAddTarget | null }
  | { name: "backup" }
  | { name: "categories" }
  | { name: "accounts" }
  | { name: "subscriptions" }
  | { name: "tax" }
  | { name: "usage" }
  | { name: "products"; month: string | null; product: string | null; by: "product" | "group" | null }
  | { name: "connect" }
  | { name: "search"; q: string; type: SearchHitType | null; page: number }
  | { name: "notfound" };

// /photos/add の紐づけ先。date は必須(実在日付)、あとは任意
export interface PhotosAddTarget {
  date: string;
  transaction_id?: string;
  event_id?: string;
  caption?: string;
}

export type PhotosAddQuery = { ok: true; target: PhotosAddTarget } | { ok: false };

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// パスとクエリから、表示するページを決める(純粋な関数。テストする)
export function parseRoute(pathname: string, search = ""): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/calendar") {
    const month = new URLSearchParams(search).get("month");
    return { name: "calendar", month: month && MONTH.test(month) ? month : null };
  }
  if (path === "/search") {
    const params = new URLSearchParams(search);
    const type = params.get("type");
    const page = Number(params.get("page") ?? "1");
    return {
      name: "search",
      q: (params.get("q") ?? "").trim().slice(0, 200),
      type: type && SEARCH_TYPES.includes(type) ? (type as SearchHitType) : null,
      page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
    };
  }
  if (path === "/photos/add") {
    const q = parsePhotosAddQuery(search);
    return { name: "photosAdd", target: q.ok ? q.target : null };
  }
  // /export と /import は Worker のAPIルート。SPAの画面は衝突しない /backup
  if (path === "/backup") return { name: "backup" };
  // カテゴリの管理。/api/categories はAPIなので衝突しない
  if (path === "/categories") return { name: "categories" };
  // 支払方法の管理。API の /api/accounts とは衝突しない
  if (path === "/accounts") return { name: "accounts" };
  // サブスク・固定費。API の /api/subscriptions とは衝突しない
  if (path === "/subscriptions") return { name: "subscriptions" };
  // 税率別の税額。API の /api/tax-summary とは衝突しない
  if (path === "/tax") return { name: "tax" };
  if (path === "/usage") return { name: "usage" };
  if (path === "/products") {
    const params = new URLSearchParams(search);
    const month = params.get("month");
    const product = (params.get("product") ?? "").trim().slice(0, 100);
    const by = params.get("by");
    return { name: "products", month: month && MONTH.test(month) ? month : null, product: product === "" ? null : product, by: by === "group" || by === "product" ? by : null };
  }
  // AI(MCP)とつなぐ手順。Worker の /mcp とは別のパス
  if (path === "/connect") return { name: "connect" };
  const day = /^\/day\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (day?.[1] && DATE.test(day[1])) return { name: "day", date: day[1] };
  // 1件の支出の明細ページ。API の /api/transactions とは衝突しない
  const tx = /^\/tx\/([^/]+)$/.exec(path);
  if (tx?.[1]) {
    let id: string;
    try {
      id = decodeURIComponent(tx[1]);
    } catch {
      return { name: "notfound" };
    }
    // API側の上限(64文字)に合わせる
    if (id.length > 0 && id.length <= 64) return { name: "transaction", id };
  }
  return { name: "notfound" };
}

// 形式だけでなく、実在する日付か(2026-02-30 などを弾く)
function isRealDate(date: string): boolean {
  if (!DATE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

// /photos/add のクエリを読んで検証する(純粋な関数。上限はAPI側の検証と同じ)
export function parsePhotosAddQuery(search: string): PhotosAddQuery {
  const params = new URLSearchParams(search);
  const date = params.get("date")?.trim() ?? "";
  if (!isRealDate(date)) return { ok: false };
  const target: PhotosAddTarget = { date };
  const fields: [keyof Omit<PhotosAddTarget, "date">, number][] = [
    ["transaction_id", 100],
    ["event_id", 100],
    ["caption", 200],
  ];
  for (const [key, max] of fields) {
    const v = params.get(key)?.trim() ?? "";
    if (v === "") continue;
    if (v.length > max) return { ok: false };
    target[key] = v;
  }
  return { ok: true, target };
}
