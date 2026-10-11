import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { testEnv } from "./helpers";

const local = { DB: testEnv().DB, AUTH_BYPASS: "1" };

describe("healthz", () => {
  it("認証を通れば200で ok:true を返す", async () => {
    const res = await createApp().request("http://localhost/healthz", {}, local);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("存在しないパスは404", async () => {
    const res = await createApp().request("http://localhost/nope", {}, local);
    expect(res.status).toBe(404);
  });
});
