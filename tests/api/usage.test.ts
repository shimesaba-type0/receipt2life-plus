import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { clearUsageCache } from "../../src/core/usage";
import { testEnv } from "../helpers";

const base = () => ({ DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

beforeEach(() => clearUsageCache());

describe("使用量のAPI", () => {
  it("設定がなければ configured: false(200)", async () => {
    const res = await createApp().request("http://localhost/api/usage", undefined, base());
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, configured: false, missing: ["CF_API_TOKEN", "CF_ACCOUNT_ID", "D1_DATABASE_ID"] });
  });

  it("設定があれば、Cloudflare の分析 API の結果を返す。失敗は 502(トークンは出さない)", async () => {
    const env = { ...base(), CF_API_TOKEN: "dummy-token", CF_ACCOUNT_ID: "dummy-account", D1_DATABASE_ID: "dummy-db" };
    const ok = (async () => new Response(JSON.stringify({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [] }] } } }))) as unknown as typeof fetch;
    const res = await createApp({ usageFetch: ok }).request("http://localhost/api/usage", undefined, env);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, configured: true, level: "ok", today: { rows_read: 0 } });

    clearUsageCache();
    const denied = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const bad = await createApp({ usageFetch: denied }).request("http://localhost/api/usage", undefined, env);
    expect(bad.status).toBe(502);
    expect(JSON.stringify(await json(bad))).not.toContain("dummy-token");
  });

  it("未認証は401", async () => {
    expect((await createApp().request("http://example.test/api/usage", {}, { DB: testEnv().DB })).status).toBe(401);
  });
});
