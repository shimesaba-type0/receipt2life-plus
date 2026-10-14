import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const local = { DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" };
const app = createApp();
const call = (path: string) => app.request(`http://localhost${path}`, undefined, local);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as any;
const enc = encodeURIComponent;

describe("検索のAPI", () => {
  it("q は省略できる(絞らず、種類・期間に当たる記録を新しい順に返す)。長すぎる q はエラー", async () => {
    expect(await json(await call("/api/search"))).toMatchObject({ ok: true, total: 0, hits: [] });
    expect((await call(`/api/search?q=${enc("あ".repeat(201))}`)).status).toBe(400);
  });

  it("出来事を探し、types・limit・不正値を扱う", async () => {
    const ev = await app.request(
      "http://localhost/api/events",
      { method: "POST", body: JSON.stringify({ title: "ダミー高原キャンプ", start_date: "2026-09-13", color: "green" }), headers: { "content-type": "application/json" } },
      local,
    );
    expect(ev.status).toBe(200);
    const hit = await json(await call(`/api/search?q=${enc("キャンプ")}`));
    expect(hit).toMatchObject({ ok: true, total: 1, latest_date: "2026-09-13", hits: [{ type: "event", title: "ダミー高原キャンプ" }] });
    expect((await json(await call(`/api/search?q=${enc("キャンプ")}&types=link,photo`))).total).toBe(0);
    expect((await call(`/api/search?q=a&types=bogus`)).status).toBe(400);
    expect((await call(`/api/search?q=a&limit=0`)).status).toBe(400);
  });
});

describe("検索チップのAPI", () => {
  it("追加・一覧・削除。言葉も対象も空、重複、長すぎは400、存在しないidは404", async () => {
    const post = (body: unknown) => app.request("http://localhost/api/search-chips", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, local);
    const added = await post({ label: "皮膚科", q: "皮膚科" });
    expect(added.status).toBe(200);
    const id = ((await added.json()) as { chip: { id: string } }).chip.id;
    expect((await post({ label: "映画", q: "", type: "seat_record" })).status).toBe(200);
    expect((await post({ label: "空", q: "" })).status).toBe(400);
    expect((await post({ label: "皮膚科", q: "別" })).status).toBe(400);
    expect((await post({ label: "あ".repeat(21), q: "x" })).status).toBe(400);
    expect((await post({ label: "型", q: "x", type: "bad" })).status).toBe(400);
    const list = (await (await app.request("http://localhost/api/search-chips", undefined, local)).json()) as { chips: { label: string; q: string; type: string | null }[] };
    expect(list.chips.map((c) => [c.label, c.q, c.type])).toEqual([["皮膚科", "皮膚科", null], ["映画", "", "seat_record"]]);
    expect((await app.request(`http://localhost/api/search-chips/${id}`, { method: "DELETE" }, local)).status).toBe(200);
    expect((await app.request("http://localhost/api/search-chips/none", { method: "DELETE" }, local)).status).toBe(404);
  });
});
