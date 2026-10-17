import type { Hono } from "hono";
import { todayJst } from "../core/dates";
import { recordBackup } from "../core/backup-log";
import type { AppEnv } from "../env";
import { buildPeriodReport, resolveReportPeriod } from "../core/period-report";
import { exportJsonl, importRecords, MAX_IMPORT_BYTES } from "../io/jsonl";
import { renderHtml } from "../io/report-html";
import { renderMarkdown } from "../io/report-markdown";

// エクスポート(GET /export)とインポート(POST /import)のルート。実装は src/io に置く
export function registerIoRoutes(app: Hono<AppEnv>): void {
  app.get("/export", async (c) => {
    // 写真の ZIP を作るために一覧だけ読むとき(?for=photos)は、バックアップの履歴に数えない
    if (c.req.query("for") !== "photos") await recordBackup(c.env.DB);
    const date = todayJst().replaceAll("-", "");
    return new Response(exportJsonl(c.env.DB), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="receipt2life-${date}.jsonl"`,
      },
    });
  });

  // 期間のレポート(読み取り専用)。?month=YYYY-MM / ?year=YYYY / ?from=&to=(366日まで)。なしは今月
  const registerReport = (path: string, ext: "md" | "html", type: string, render: typeof renderMarkdown) => {
    app.get(path, async (c) => {
      const resolved = resolveReportPeriod(c.req.query());
      if (!resolved.ok) return c.json({ ok: false, error: resolved.errors.map((e) => e.message).join(" / ") }, 400);
      const report = await buildPeriodReport(c.env.DB, resolved.period);
      if (!report.ok) return c.json({ ok: false, error: report.errors.map((e) => e.message).join(" / ") }, 400);
      return new Response(render(report), {
        headers: {
          "content-type": type,
          "content-disposition": `attachment; filename="receipt2life-${resolved.period.slug}.${ext}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        },
      });
    });
  };
  registerReport("/export/markdown", "md", "text/markdown; charset=utf-8", renderMarkdown);
  registerReport("/export/html", "html", "text/html; charset=utf-8", renderHtml);

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
