import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

describe("想定外の例外", () => {
  it("/api/* はJSONの500で返し、ログに理由を出す", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fail = async () => {
      throw new Error("no such column: t.example");
    };
    const stmt = { bind: () => stmt, first: fail, all: fail, run: fail };
    const broken = { prepare: () => stmt, batch: fail } as unknown as D1Database;
    const app = createApp();
    const res = await app.request("http://localhost/api/home", {}, { DB: broken, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; errors: { field: string; message: string }[] };
    expect(body.ok).toBe(false);
    expect(body.errors[0]?.message).toContain("no such column");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
