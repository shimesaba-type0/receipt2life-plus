import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("healthz", () => {
  it("200で ok:true を返す", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("存在しないパスは404", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});
