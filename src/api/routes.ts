import type { Context, Hono } from "hono";
import { getCalendar, getDay } from "../core/calendar";
import { addAccount, deleteAccount, listAccounts, updateAccount } from "../core/accounts";
import { addCategory, deleteCategory, listCategories, renameGroup, updateCategory } from "../core/categories";
import { addEvent, deleteEvent, updateEvent } from "../core/events";
import { getHome } from "../core/home";
import { addLink, deleteLink, updateLink } from "../core/links";
import { addSeatRecord, deleteSeatRecord, listSeatRecords, updateSeatRecord } from "../core/seat-records";
import { listVenues, updateScreen, updateVenue } from "../core/venues";
import { deletePhoto, getPhoto, MAX_PHOTO_BYTES, savePhoto } from "../core/photos";
import { addTransactions, deleteTransaction, getTransaction, updateTransaction } from "../core/transactions";
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
export function registerApiRoutes(app: Hono<AppEnv>): void {
  app.use("/api/*", noStoreJson, sameOriginOnly);
  app.use("/api/:kind/:id", shortIdOnly);
  for (const path of ["/api/transactions", "/api/transactions/:id", "/api/events", "/api/events/:id", "/api/links", "/api/links/:id", "/api/seat-records", "/api/seat-records/:id", "/api/venues/:id", "/api/screens/:id", "/api/categories", "/api/categories/:name", "/api/category-groups/rename", "/api/accounts", "/api/accounts/:name"]) app.use(path, requireJson);

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

  // 外部リンク(Xの投稿・YouTubeの動画)
  app.post("/api/links", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addLink(c.env.DB, body.value));
  });

  app.patch("/api/links/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateLink(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  app.delete("/api/links/:id", async (c) => respond(c, await deleteLink(c.env.DB, { id: c.req.param("id") })));

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

  app.delete("/api/photos/:id", async (c) => {
    const result = await deletePhoto(c.env.DB, c.env.PHOTOS, c.req.param("id"));
    if (!result.ok) return fail(c, result.status === 413 ? 400 : result.status, result.errors);
    return c.json({ ok: true as const, deleted: result.deleted, message: result.message });
  });
}
