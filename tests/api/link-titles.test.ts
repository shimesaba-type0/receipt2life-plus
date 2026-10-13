import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const send = (method: string, path: string, body?: unknown) =>
  app.request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }, local);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;

describe("API リンクのタイトル取得", () => {
  it("取得の仕組みを渡した app: 登録でタイトルが付き、タイトルが無いリンクには POST /title で付けられる", async () => {
    const withFetch = createApp({ fetchTitle: async () => "取得したタイトル" });
    const sendF = (method: string, path: string, body?: unknown) =>
      withFetch.request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }, local);
    const added = await json(await sendF("POST", "/api/links", { url: "https://youtu.be/abcdefghijk", date: "2026-10-10" }));
    expect(added).toMatchObject({ ok: true, link: { title: "取得したタイトル" } });
    // タイトルを消してから、取得し直す
    await sendF("PATCH", `/api/links/${added.link.id}`, { title: null });
    const again = await json(await sendF("POST", `/api/links/${added.link.id}/title`));
    expect(again).toMatchObject({ ok: true, link: { title: "取得したタイトル" } });
    expect((await sendF("POST", "/api/links/nope/title")).status).toBe(404);
  });

  it("取得の仕組みが無い app(テスト・既定)では、登録はタイトルなし、POST /title は500", async () => {
    const added = await json(await send("POST", "/api/links", { url: "https://youtu.be/abcdefghijk", date: "2026-10-10" }));
    expect(added.link.title).toBeNull();
    expect((await send("POST", `/api/links/${added.link.id}/title`)).status).toBe(500);
  });
});
