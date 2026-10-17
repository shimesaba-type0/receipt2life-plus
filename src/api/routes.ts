import type { Context, Hono } from "hono";
import { getCalendar, getDay } from "../core/calendar";
import { addAccount, deleteAccount, listAccounts, updateAccount } from "../core/accounts";
import { addCategory, deleteCategory, listCategories, renameGroup, updateCategory } from "../core/categories";
import { addEvent, deleteEvent, updateEvent } from "../core/events";
import { summarizeDiscounts } from "../core/discounts";
import { getHome } from "../core/home";
import { listMerchants } from "../core/merchants";
import { addLink, deleteLink, refreshLinkTitle, updateLink } from "../core/links";
import type { TitleFetcher } from "../core/link-titles";
import { addSeatRecord, deleteSeatRecord, listSeatRecords, updateSeatRecord } from "../core/seat-records";
import { listVenues, updateScreen, updateVenue } from "../core/venues";
import { deletePhoto, getPhoto, MAX_PHOTO_BYTES, restorePhoto, savePhoto } from "../core/photos";
import { addTransactions, deleteTransaction, getTransaction, updateTransaction } from "../core/transactions";
import { summarizeDeductions } from "../core/deductions";
import { addSubscription, deleteSubscription, listSubscriptions, updateSubscription } from "../core/subscriptions";
import { getUsage } from "../core/usage";
import { listProducts, productHistory } from "../core/products";
import { createGroup, deleteGroup, listGroups, updateGroup } from "../core/product-groups";
import { addChip, deleteChip, listChips } from "../core/search-chips";
import { addExclude, deleteExclude, listExcludes } from "../core/product-excludes";
import { compareMonths } from "../core/compare";
import { searchRecords } from "../core/search";
import { summarizeTax } from "../core/tax-summary";
import type { AppEnv } from "../env";
import { noStoreJson, requireJson, sameOriginOnly, shortIdOnly } from "./guards";
import type { FieldError } from "../core/schema";

type Ctx = Context<AppEnv>;

// multipart の枠(境界・フィールド)ぶんの余裕。これを超える本文は、読み込む前に断る
const MULTIPART_OVERHEAD = 64 * 1024;

const fail = (c: Ctx, status: 400 | 404 | 413 | 500, errors: FieldError[]) => c.json({ ok: false as const, errors }, status);

// core は成功/失敗だけを返す。「存在しない id」は id 項目の「〜はありません」で表すので、404 に対応づける
// カテゴリ・大分類は、名前(name / group)で指す。move_to は入力の誤りなので 400
const isNotFound = (errors: FieldError[]) => errors.some((e) => (e.field === "id" || e.field === "name" || e.field === "group") && /という.+はありません/.test(e.message));

function respond(c: Ctx, result: { ok: true } | { ok: false; errors: FieldError[] }) {
  if (result.ok) return c.json(result);
  return fail(c, isNotFound(result.errors) ? 404 : 400, result.errors);
}

// JSON本文(オブジェクト)を読む。壊れている、またはオブジェクトでなければ null
async function readJson(c: Ctx): Promise<{ value: Record<string, unknown> } | null> {
  try {
    const value: unknown = await c.req.json();
    return value && typeof value === "object" && !Array.isArray(value) ? { value: value as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

const badJson = (c: Ctx) => fail(c, 400, [{ field: "body", message: "body: JSONとして読めません。JSONオブジェクトを送ってください" }]);

// Web UI 用のAPI(/api/*)。docs/api.md の契約に沿って、核(core)の関数を呼んで実装する
export interface ApiRouteOptions {
  fetchTitle?: TitleFetcher;
  usageFetch?: typeof fetch;
}

export function registerApiRoutes(app: Hono<AppEnv>, options: ApiRouteOptions = {}): void {
  app.use("/api/*", noStoreJson, sameOriginOnly);
  app.use("/api/:kind/:id", shortIdOnly);
  for (const path of ["/api/transactions", "/api/transactions/:id", "/api/events", "/api/events/:id", "/api/links", "/api/links/:id", "/api/seat-records", "/api/seat-records/:id", "/api/venues/:id", "/api/screens/:id", "/api/categories", "/api/categories/:name", "/api/category-groups/rename", "/api/accounts", "/api/accounts/:name", "/api/product-excludes", "/api/product-excludes/:id", "/api/search-chips", "/api/search-chips/:id", "/api/product-groups", "/api/product-groups/:id"]) app.use(path, requireJson);

  app.get("/api/home", async (c) => respond(c, await getHome(c.env.DB)));

  app.get("/api/calendar", async (c) => respond(c, await getCalendar(c.env.DB, c.req.query("month") || undefined)));

  app.get("/api/day/:date", async (c) => respond(c, await getDay(c.env.DB, c.req.param("date"))));

  // 税率別の税額(レシートに印字された税の内訳の合計)とカバレッジ。from / to / group_by(rate / month)。空のクエリは省略扱い
  app.get("/api/tax-summary", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["from", "to", "group_by"]) if (q[key]) input[key] = q[key];
    return respond(c, await summarizeTax(c.env.DB, input));
  });

  // 確定申告の参考: セルフメディケーション税制・医療費控除のフラグが付いた支出の合計(医療費は交通費を含む・含まない)。from / to。空のクエリは省略扱い
  app.get("/api/deductions", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["from", "to"]) if (q[key]) input[key] = q[key];
    return respond(c, await summarizeDeductions(c.env.DB, input));
  });

  // 割引の集計(レシートに印字された割引行だけ)。from / to / group_by(none / merchant / category / month。既定 none)。空のクエリは省略扱い
  app.get("/api/discounts", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["from", "to", "group_by"]) if (q[key]) input[key] = q[key];
    return respond(c, await summarizeDiscounts(c.env.DB, input));
  });

  // 店名の候補(過去の取引から店名ごとにまとめる)。q / category / limit。空のクエリは省略扱い。limit は数値にして検証に渡す
  app.get("/api/merchants", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["q", "category"]) if (q[key]) input[key] = q[key];
    if (q.limit) input.limit = Number(q.limit);
    return respond(c, await listMerchants(c.env.DB, input));
  });

  // 商品ごとの集計(買った数・金額・単価の推移)。一覧は from / to / q / limit、履歴は product(必須)/ from / to
  app.get("/api/products", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["from", "to", "q", "sort", "by"]) if (q[key]) input[key] = q[key];
    if (q.limit) input.limit = Number(q.limit);
    return respond(c, await listProducts(c.env.DB, input));
  });
  // 商品の集計に入れない言葉(消費税・割引など)の管理
  app.get("/api/product-excludes", async (c) => respond(c, await listExcludes(c.env.DB)));
  app.post("/api/product-excludes", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addExclude(c.env.DB, body.value));
  });
  app.delete("/api/product-excludes/:id", async (c) => respond(c, await deleteExclude(c.env.DB, { id: c.req.param("id") })));
  app.get("/api/products/history", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["product", "from", "to", "by"]) if (q[key]) input[key] = q[key];
    return respond(c, await productHistory(c.env.DB, input));
  });

  // D1 の使用量(Cloudflare の分析 API から取る。設定がなければ configured: false。取得に失敗したら502)
  app.get("/api/usage", async (c) => {
    const result = await getUsage(c.env, { fetchImpl: options.usageFetch });
    return result.ok ? c.json(result) : c.json(result, 502);
  });

  // 月の比較。month / base(previous・year_ago・YYYY-MM)/ group_by / until_day
  app.get("/api/compare", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["month", "base", "group_by"]) if (q[key]) input[key] = q[key];
    if (q.until_day) input.until_day = Number(q.until_day);
    return respond(c, await compareMonths(c.env.DB, input));
  });

  // 記録の横断検索。q(空白区切りで AND)/ from / to / types(カンマ区切り)/ limit / offset
  app.get("/api/search", async (c) => {
    const q = c.req.query();
    const input: Record<string, unknown> = {};
    for (const key of ["q", "from", "to"]) if (q[key]) input[key] = q[key];
    if (q.types) input.types = q.types.split(",");
    if (q.limit) input.limit = Number(q.limit);
    if (q.offset) input.offset = Number(q.offset);
    return respond(c, await searchRecords(c.env.DB, input));
  });

  // 商品の「まとめ名」(表記ゆれ・似た商品をくくる)の管理
  app.get("/api/product-groups", async (c) => respond(c, await listGroups(c.env.DB)));
  app.post("/api/product-groups", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await createGroup(c.env.DB, body.value));
  });
  app.put("/api/product-groups/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateGroup(c.env.DB, c.req.param("id"), body.value));
  });
  app.delete("/api/product-groups/:id", async (c) => respond(c, await deleteGroup(c.env.DB, c.req.param("id"))));

  // 検索の「よく使う検索」チップ
  app.get("/api/search-chips", async (c) => respond(c, await listChips(c.env.DB)));
  app.post("/api/search-chips", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addChip(c.env.DB, body.value));
  });
  app.delete("/api/search-chips/:id", async (c) => respond(c, await deleteChip(c.env.DB, { id: c.req.param("id") })));

  app.get("/api/categories", async (c) => {
    const { categories, accounts } = await listCategories(c.env.DB);
    return c.json({ ok: true as const, categories, accounts });
  });

  // カテゴリの管理(大分類の下のサブカテゴリ)。:name はURLエンコードしたカテゴリ名
  app.post("/api/categories", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addCategory(c.env.DB, body.value));
  });

  app.patch("/api/categories/:name", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateCategory(c.env.DB, { ...body.value, name: c.req.param("name") }));
  });

  app.delete("/api/categories/:name", async (c) => {
    const moveTo = c.req.query("move_to");
    return respond(c, await deleteCategory(c.env.DB, { name: c.req.param("name"), ...(moveTo ? { move_to: moveTo } : {}) }));
  });

  // 口座(支払方法)の管理。:name はURLエンコードした口座名。GET /api/categories の accounts は名前だけ(互換のため)
  app.get("/api/accounts", async (c) => {
    const { accounts } = await listAccounts(c.env.DB);
    return c.json({ ok: true as const, accounts });
  });

  app.post("/api/accounts", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addAccount(c.env.DB, body.value));
  });

  app.patch("/api/accounts/:name", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateAccount(c.env.DB, { ...body.value, name: c.req.param("name") }));
  });

  app.delete("/api/accounts/:name", async (c) => {
    const moveTo = c.req.query("move_to");
    return respond(c, await deleteAccount(c.env.DB, { name: c.req.param("name"), ...(moveTo ? { move_to: moveTo } : {}) }));
  });

  app.post("/api/category-groups/rename", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await renameGroup(c.env.DB, body.value));
  });

  // 取引
  app.post("/api/transactions", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addTransactions(c.env.DB, body.value));
  });

  // 1件の取引(明細・写真・リンクつき)
  app.get("/api/transactions/:id", async (c) => respond(c, await getTransaction(c.env.DB, c.req.param("id"))));

  app.patch("/api/transactions/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateTransaction(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  // ?delete_photos=1 で、紐づく写真(R2の実体も)をいっしょに消す。無ければ写真つきの取引は 400 で断る
  app.delete("/api/transactions/:id", async (c) => {
    const flag = c.req.query("delete_photos");
    if (flag !== undefined && flag !== "0" && flag !== "1") {
      return fail(c, 400, [{ field: "delete_photos", message: "delete_photos: 1(写真もいっしょに削除)か 0 で指定してください" }]);
    }
    return respond(c, await deleteTransaction(c.env.DB, { id: c.req.param("id"), delete_photos: flag === "1" }, { bucket: c.env.PHOTOS }));
  });

  // 出来事
  app.post("/api/events", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addEvent(c.env.DB, body.value));
  });

  app.patch("/api/events/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateEvent(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  app.delete("/api/events/:id", async (c) => respond(c, await deleteEvent(c.env.DB, { id: c.req.param("id") })));

  // 外部リンク(Xの投稿・YouTubeの動画・Instagram・ウェブのページ)
  app.post("/api/links", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addLink(c.env.DB, body.value, { fetchTitle: options.fetchTitle }));
  });

  app.patch("/api/links/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateLink(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  // タイトルが無いリンクのタイトルを、取りに行って付ける(oEmbed)。取得の仕組みが無い環境(テスト)では500
  app.post("/api/links/:id/title", async (c) => {
    if (!options.fetchTitle) return fail(c, 500, [{ field: "title", message: "title: タイトルの取得は、この環境では使えません" }]);
    return respond(c, await refreshLinkTitle(c.env.DB, { id: c.req.param("id") }, options.fetchTitle));
  });

  app.delete("/api/links/:id", async (c) => respond(c, await deleteLink(c.env.DB, { id: c.req.param("id") })));

  // サブスク・保険などの固定費(別枠)。一覧は active(true / false)と kind で絞れる。空のクエリは省略扱い
  app.get("/api/subscriptions", async (c) => {
    const q = c.req.query();
    const filter: Record<string, unknown> = {};
    if (q.kind) filter.kind = q.kind;
    if (q.active === "true" || q.active === "false") filter.active = q.active === "true";
    else if (q.active) filter.active = q.active;
    return respond(c, await listSubscriptions(c.env.DB, filter));
  });

  app.post("/api/subscriptions", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addSubscription(c.env.DB, body.value));
  });

  app.patch("/api/subscriptions/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateSubscription(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  app.delete("/api/subscriptions/:id", async (c) => respond(c, await deleteSubscription(c.env.DB, { id: c.req.param("id") })));

  // 座席の記録(映画館などの席の評価)。一覧は絞り込み: date(その日)/ title(部分一致)/ venue / screen / seat / seat_class(部分一致)/ min_rating / max_rating / from / to / transaction_id / limit
  app.get("/api/seat-records", async (c) => {
    const q = c.req.query();
    const filter: Record<string, unknown> = {};
    for (const key of ["title", "venue", "screen", "seat", "seat_class", "from", "to", "transaction_id"]) if (q[key]) filter[key] = q[key];
    // date は「その日だけ」(from と to を同じ日にする)
    if (q.date) {
      filter.from = q.date;
      filter.to = q.date;
    }
    // 数値は文字列で届くので変換する。数値にならないものは NaN になり、検証でエラーになる
    for (const key of ["min_rating", "max_rating", "limit"]) if (q[key]) filter[key] = Number(q[key]);
    return respond(c, await listSeatRecords(c.env.DB, filter));
  });

  app.post("/api/seat-records", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addSeatRecord(c.env.DB, body.value));
  });

  app.patch("/api/seat-records/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateSeatRecord(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  app.delete("/api/seat-records/:id", async (c) => respond(c, await deleteSeatRecord(c.env.DB, { id: c.req.param("id") })));

  // 会場・スクリーン(座席の記録とは別のレコード)。削除はなし。座席の記録の venue / screen は名前で受けて、無ければ作る
  app.get("/api/venues", async (c) => respond(c, await listVenues(c.env.DB)));

  app.patch("/api/venues/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateVenue(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  app.patch("/api/screens/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateScreen(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  // 写真
  app.post("/api/photos", async (c) => {
    const tooBig = () => fail(c, 413, [{ field: "file", message: "file: 写真が大きすぎます(上限は5MB)。縮小してから送ってください" }]);
    // 大きな本文は、読み込む前に Content-Length で断る
    const rawLength = c.req.header("content-length");
    if (rawLength === undefined) {
      // チャンク転送だと大きさが分からないまま読み込むことになるので断る
      return c.json({ ok: false as const, errors: [{ field: "body", message: "body: Content-Length が必要です。ファイルの大きさが分かる形で送ってください" }] }, 411);
    }
    const length = Number(rawLength);
    if (!Number.isFinite(length) || length > MAX_PHOTO_BYTES + MULTIPART_OVERHEAD) return tooBig();

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return fail(c, 400, [{ field: "body", message: "body: multipart/form-data として読めません。file に写真を付けて送ってください" }]);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return fail(c, 400, [{ field: "file", message: "file: 写真のファイルが必要です" }]);
    if (file.size > MAX_PHOTO_BYTES) return tooBig();

    const meta: Record<string, unknown> = {};
    for (const key of ["date", "transaction_id", "event_id", "caption"]) {
      const v = form.get(key);
      if (typeof v === "string") meta[key] = v;
    }
    try {
      const result = await savePhoto(c.env.DB, c.env.PHOTOS, await file.arrayBuffer(), meta);
      if (!result.ok) return fail(c, result.status, result.errors);
      return c.json({ ok: true as const, photo: result.photo });
    } catch {
      return fail(c, 500, [{ field: "file", message: "file: 写真を保存できませんでした。しばらくしてからもう一度試してください" }]);
    }
  });

  app.get("/api/photos/:id", async (c) => {
    const result = await getPhoto(c.env.DB, c.env.PHOTOS, c.req.param("id"));
    if (!result.ok) return fail(c, result.status === 413 ? 400 : result.status, result.errors);
    return new Response(result.body, {
      headers: {
        "content-type": result.contentType,
        "content-length": String(result.size),
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": "inline",
        "cross-origin-resource-policy": "same-origin",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  });

  // バックアップの写真(ZIP)から、写真の実体だけを戻す。本文は画像そのもの(Content-Length が必要)。メタ情報は、先に読み込んだバックアップ(JSONL)の行から
  app.put("/api/photos/:id/restore", async (c) => {
    const rawLength = c.req.header("content-length");
    if (rawLength === undefined) return c.json({ ok: false as const, errors: [{ field: "body", message: "body: Content-Length が必要です" }] }, 411);
    const length = Number(rawLength);
    if (!Number.isFinite(length) || length > MAX_PHOTO_BYTES) return fail(c, 413, [{ field: "file", message: "file: 写真が大きすぎます(上限は5MB)" }]);
    try {
      const result = await restorePhoto(c.env.DB, c.env.PHOTOS, c.req.param("id"), await c.req.arrayBuffer());
      if (!result.ok) return fail(c, result.status, result.errors);
      return c.json({ ok: true as const, status: result.status, id: result.id, message: result.message });
    } catch {
      return fail(c, 500, [{ field: "file", message: "file: 写真を戻せませんでした。しばらくしてからもう一度試してください" }]);
    }
  });

  app.delete("/api/photos/:id", async (c) => {
    const result = await deletePhoto(c.env.DB, c.env.PHOTOS, c.req.param("id"));
    if (!result.ok) return fail(c, result.status === 413 ? 400 : result.status, result.errors);
    return c.json({ ok: true as const, deleted: result.deleted, message: result.message });
  });
}
