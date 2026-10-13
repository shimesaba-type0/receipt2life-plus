import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string) => app.request(`http://localhost${path}`, undefined, local);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("月の比較のAPI", () => {
  it("取引がなくても比べられる。月・base・until_day の不正値は400", async () => {
    const ok = await json(await call("/api/compare?month=2026-10&base=year_ago&until_day=10"));
    expect(ok).toMatchObject({ ok: true, month: "2026-10", base_month: "2025-10", until_day: 10, total: 0, base_total: 0, diff: 0, diff_percent: null, rows: [] });
    expect((await call("/api/compare?month=2026-13")).status).toBe(400);
    expect((await call("/api/compare?month=2026-10&base=2026-10")).status).toBe(400);
    expect((await call("/api/compare?until_day=0")).status).toBe(400);
    expect((await call("/api/compare?group_by=merchant")).status).toBe(400);
  });
});
