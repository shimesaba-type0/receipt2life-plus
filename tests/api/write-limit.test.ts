import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { createWindowLimiter } from "../../src/api/write-limit";
import { testEnv } from "../helpers";

const env = () => ({ DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" });
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, env());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("createWindowLimiter", () => {
  it("窓の中の回数だけ通し、超えたら待ち秒数を返す。窓が過ぎれば通る", () => {
    let t = 0;
    const l = createWindowLimiter({ limit: 2, windowMs: 1000 }, () => t);
    expect(l.take().ok).toBe(true);
    t = 100;
    expect(l.take().ok).toBe(true);
    t = 200;
    expect(l.take()).toEqual({ ok: false, retryAfterSec: 1 });
    t = 1000;
    expect(l.take().ok).toBe(true);
    t = 1100;
    expect(l.take().ok).toBe(true);
    t = 1150;
    expect(l.take().ok).toBe(false);
  });
});

describe("書き込みの回数の制限", () => {
  it("API の書き込みは、制限を超えたら 429(Retry-After つき)。読み取りは数えない", async () => {
    const app = createApp({ writeLimits: { api: { limit: 3, windowMs: 60_000 } } });
    for (let i = 0; i < 3; i++) expect((await post(app, "/api/events", { title: `e${i}`, start_date: "2026-10-10", color: "red" })).status).toBe(200);
    const over = await post(app, "/api/events", { title: "e4", start_date: "2026-10-10", color: "red" });
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await json(over)).toMatchObject({ ok: false, errors: [{ field: "rate_limit" }] });
    // 超えたあとも、読み取りは通る
    expect((await app.request("http://localhost/api/home", undefined, env())).status).toBe(200);
    // 止められた書き込みは、DB に入っていない
    const n = await testEnv().DB.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>();
    expect(n!.n).toBe(3);
  });

  it("MCP は別の枠(POST だけ数える)。超えたら 429", async () => {
    const app = createApp({ writeLimits: { mcp: { limit: 2, windowMs: 60_000 } } });
    const rpc = () =>
      app.request("http://localhost/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }, env());
    expect((await rpc()).status).toBe(200);
    expect((await rpc()).status).toBe(200);
    expect((await rpc()).status).toBe(429);
  });

  it("既定の枠は、ふつうの使い方では届かない(120回/分)", async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) expect((await post(app, "/api/events", { title: `e${i}`, start_date: "2026-10-10", color: "red" })).status).toBe(200);
  });
});
