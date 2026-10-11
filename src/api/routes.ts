import type { Context, Hono } from "hono";
import { getCalendar, getDay } from "../core/calendar";
import { listCategories } from "../core/categories";
import { addEvent, deleteEvent, updateEvent } from "../core/events";
import { getHome } from "../core/home";
import { deletePhoto, getPhoto, MAX_PHOTO_BYTES, savePhoto } from "../core/photos";
import { addTransactions, deleteTransaction, updateTransaction } from "../core/transactions";
import type { AppEnv } from "../env";
import type { FieldError } from "../core/schema";

type Ctx = Context<AppEnv>;

// multipart の枠(境界・フィールド)ぶんの余裕。これを超える本文は、読み込む前に断る
const MULTIPART_OVERHEAD = 64 * 1024;

const fail = (c: Ctx, status: 400 | 404 | 413 | 500, errors: FieldError[]) => c.json({ ok: false as const, errors }, status);

// core は成功/失敗だけを返す。「存在しない id」は id 項目の「〜はありません」で表すので、404 に対応づける
const isNotFound = (errors: FieldError[]) => errors.some((e) => e.field === "id" && /という.+はありません/.test(e.message));

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
  app.get("/api/home", async (c) => respond(c, await getHome(c.env.DB)));

  app.get("/api/calendar", async (c) => respond(c, await getCalendar(c.env.DB, c.req.query("month") || undefined)));

  app.get("/api/day/:date", async (c) => respond(c, await getDay(c.env.DB, c.req.param("date"))));

  app.get("/api/categories", async (c) => {
    const { categories, accounts } = await listCategories(c.env.DB);
    return c.json({ ok: true as const, categories, accounts });
  });

  // 取引
  app.post("/api/transactions", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await addTransactions(c.env.DB, body.value));
  });

  app.patch("/api/transactions/:id", async (c) => {
    const body = await readJson(c);
    if (!body) return badJson(c);
    return respond(c, await updateTransaction(c.env.DB, { ...body.value, id: c.req.param("id") }));
  });

  app.delete("/api/transactions/:id", async (c) => respond(c, await deleteTransaction(c.env.DB, { id: c.req.param("id") })));

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

  // 写真
  app.post("/api/photos", async (c) => {
    const tooBig = () => fail(c, 413, [{ field: "file", message: "file: 写真が大きすぎます(上限は5MB)。縮小してから送ってください" }]);
    // 大きな本文は、読み込む前に Content-Length で断る
    const length = Number(c.req.header("content-length"));
    if (Number.isFinite(length) && length > MAX_PHOTO_BYTES + MULTIPART_OVERHEAD) return tooBig();

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
