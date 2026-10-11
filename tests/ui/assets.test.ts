import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

// Web UI の静的ファイルは、認証の内側で配信する(run_worker_first)
const fakeAssets = { fetch: async (req: Request) => new Response(`asset:${new URL(req.url).pathname}`) } as unknown as Fetcher;
const local = () => ({ DB: testEnv().DB, AUTH_BYPASS: "1", ASSETS: fakeAssets });

describe("静的ファイルの配信", () => {
  it("認証なしは401(画面のファイルも守られる)", async () => {
    const res = await createApp().request("https://app.example.com/", {}, { DB: testEnv().DB, ASSETS: fakeAssets });
    expect(res.status).toBe(401);
  });

  it("認証済みなら、ASSETS に渡す", async () => {
    const res = await createApp().request("http://localhost/calendar", {}, local());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset:/calendar");
  });

  it("未定義の /api/* は、画面ではなく404のJSON", async () => {
    const res = await createApp().request("http://localhost/api/nope", {}, local());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("ASSETS が無い環境でも、落ちずに404", async () => {
    const res = await createApp().request("http://localhost/", {}, { DB: testEnv().DB, AUTH_BYPASS: "1" });
    expect(res.status).toBe(404);
  });
});
