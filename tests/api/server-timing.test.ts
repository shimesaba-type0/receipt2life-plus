import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();

describe("/api/* の応答時間", () => {
  it("Server-Timing が付く(成功も、存在しないAPIの404も)", async () => {
    const ok = await app.request("http://localhost/api/home", undefined, local);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("server-timing")).toMatch(/^app;dur=\d+$/);
    const nf = await app.request("http://localhost/api/nope", undefined, local);
    expect(nf.status).toBe(404);
    expect(nf.headers.get("server-timing")).toMatch(/^app;dur=\d+$/);
  });

  it("画面(静的ファイル)や /healthz には付けない", async () => {
    const res = await app.request("http://localhost/healthz", undefined, local);
    expect(res.headers.get("server-timing")).toBeNull();
  });
});
