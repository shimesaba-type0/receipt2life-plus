import type { Hono } from "hono";
import { todayJst } from "../core/dates";
import type { AppEnv } from "../env";
import { exportJsonl, importRecords, MAX_IMPORT_BYTES } from "../io/jsonl";

// エクスポート(GET /export)とインポート(POST /import)のルート。実装は src/io に置く
export function registerIoRoutes(app: Hono<AppEnv>): void {
  app.get("/export", (c) => {
    const date = todayJst().replaceAll("-", "");
    return new Response(exportJsonl(c.env.DB), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="receipt2life-${date}.jsonl"`,
      },
    });
  });

  app.post("/import", async (c) => {
    // 大きな本文は、読み込む前に Content-Length で断る
    const length = Number(c.req.header("content-length"));
    if (Number.isFinite(length) && length > MAX_IMPORT_BYTES) {
      return c.json({ ok: false, error: "本文が大きすぎます(上限は5MB)。ファイルを分けて送ってください" }, 413);
    }
    const result = await importRecords(c.env.DB, await c.req.text());
    if (!result.ok) return c.json({ ok: false, error: result.error }, result.status);
    return c.json(result);
  });
}
