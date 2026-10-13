import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { savePhoto } from "../../src/core/photos";
import { NOW, testEnv } from "../helpers";

const env = () => ({ DB: testEnv().DB, PHOTOS: testEnv().PHOTOS, AUTH_BYPASS: "1" });

async function rpc(method: string, params?: unknown, base = "http://localhost") {
  const res = await createApp().request(
    `${base}/mcp`,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    env(),
  );
  return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const callTool = (name: string, args: unknown, base?: string) => rpc("tools/call", { name, arguments: args }, base);
const text = (r: Awaited<ReturnType<typeof rpc>>) => JSON.parse(r.body.result.content[0].text);
const images = (r: Awaited<ReturnType<typeof rpc>>) =>
  (r.body.result.content as { type: string; data?: string; mimeType?: string }[]).filter((c) => c.type === "image");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function seedPhoto(bytes: Uint8Array, meta: Record<string, string>): Promise<string> {
  const r = await savePhoto(testEnv().DB, testEnv().PHOTOS, bytes.slice().buffer, meta, { now: NOW });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.photo.id;
}

async function seedTransaction(date = "2026-10-10"): Promise<string> {
  const r = await callTool("add_transactions", { transactions: [{ date, amount: 500, merchant: "A店", category: "食費" }] });
  return text(r).registered[0].id as string;
}

async function seedEvent(start: string, end?: string): Promise<string> {
  const r = await callTool("add_event", { title: "出張", start_date: start, ...(end ? { end_date: end } : {}) });
  return text(r).event.id as string;
}

describe("MCP 写真のツール", () => {
  it("tools/list は35個で、写真の3ツールの説明が具体的", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string }[];
    expect(tools).toHaveLength(35);
    const byName = (n: string) => tools.find((t) => t.name === n)!;
    expect(byName("create_photo_upload_link").description).toContain("リンク");
    expect(byName("create_photo_upload_link").description).toContain("ユーザー");
    expect(byName("list_photos").description).toContain("get_photos");
    expect(byName("get_photos").description).toContain("add_transactions");
    for (const n of ["create_photo_upload_link", "list_photos", "get_photos"]) {
      expect(byName(n).description.length).toBeGreaterThan(100);
    }
  });

  describe("create_photo_upload_link", () => {
    it("日付だけ: MCPリクエストのオリジンでURLを作る(固定ドメインを使わない)", async () => {
      const r = await callTool("create_photo_upload_link", { date: "2026-10-10" }, "http://localhost:8787");
      expect(r.body.result.isError).toBeFalsy();
      const out = text(r);
      expect(out).toMatchObject({ ok: true, url: "http://localhost:8787/photos/add?date=2026-10-10" });
      expect(out.message).toContain("このリンクを開いて写真を選んでください");
      expect(out.message).toContain(out.url);
    });

    it("指定した項目だけがクエリに入る", async () => {
      const tx = await seedTransaction();
      const ev = await seedEvent("2026-10-09", "2026-10-11");
      const r = await callTool("create_photo_upload_link", { date: "2026-10-10", transaction_id: tx, event_id: ev, caption: "半券 A" });
      const url = new URL(text(r).url);
      expect(url.pathname).toBe("/photos/add");
      expect(Object.fromEntries(url.searchParams)).toEqual({ date: "2026-10-10", transaction_id: tx, event_id: ev, caption: "半券 A" });

      const onlyTx = await callTool("create_photo_upload_link", { transaction_id: tx });
      expect(text(onlyTx).url).toBe(`http://localhost/photos/add?transaction_id=${tx}`);
    });

    it("date・transaction_id・event_id が全部無いと検証エラー", async () => {
      const r = await callTool("create_photo_upload_link", { caption: "だけ" });
      expect(r.body.result.isError).toBe(true);
      expect(text(r)).toMatchObject({ ok: false, errors: [{ field: "date" }] });
    });

    it("存在しない参照先は検証エラー", async () => {
      const r = await callTool("create_photo_upload_link", { transaction_id: "no-tx", event_id: "no-ev" });
      expect(r.body.result.isError).toBe(true);
      const fields = text(r).errors.map((e: { field: string }) => e.field);
      expect(fields).toEqual(["transaction_id", "event_id"]);
    });

    it("不正な日付は検証エラー", async () => {
      const r = await callTool("create_photo_upload_link", { date: "2026-13-01" });
      expect(r.body.result.isError).toBe(true);
    });
  });

  describe("list_photos", () => {
    it("日付指定は日の詳細と同じ条件(日付・その日の取引・重なる出来事)", async () => {
      const tx = await seedTransaction("2026-10-10");
      const ev = await seedEvent("2026-10-09", "2026-10-11");
      const byDate = await seedPhoto(JPEG, { date: "2026-10-10", caption: "日付" });
      const byTx = await seedPhoto(PNG, { transaction_id: tx });
      const byEv = await seedPhoto(JPEG, { event_id: ev });
      await seedPhoto(JPEG, { date: "2026-10-01" }); // 別の日

      const r = await callTool("list_photos", { date: "2026-10-10" });
      const out = text(r);
      expect(out.ok).toBe(true);
      expect(out.count).toBe(3);
      expect(out.photos.map((p: { id: string }) => p.id).sort()).toEqual([byDate, byTx, byEv].sort());
      const first = out.photos.find((p: { id: string }) => p.id === byDate);
      expect(first).toEqual({
        id: byDate,
        date: "2026-10-10",
        transaction_id: null,
        event_id: null,
        caption: "日付",
        content_type: "image/jpeg",
        size: JPEG.byteLength,
        created_at: NOW.toISOString(),
      });
      expect(out.photos.find((p: { id: string }) => p.id === byTx).content_type).toBe("image/png");
    });

    it("transaction_id / event_id 指定は、その紐づけの写真だけ", async () => {
      const tx = await seedTransaction();
      const ev = await seedEvent("2026-10-09");
      const a = await seedPhoto(JPEG, { transaction_id: tx });
      const b = await seedPhoto(JPEG, { event_id: ev });
      expect(text(await callTool("list_photos", { transaction_id: tx })).photos.map((p: { id: string }) => p.id)).toEqual([a]);
      expect(text(await callTool("list_photos", { event_id: ev })).photos.map((p: { id: string }) => p.id)).toEqual([b]);
    });

    it("複数指定は和集合で、重複しない", async () => {
      const tx = await seedTransaction("2026-10-10");
      const a = await seedPhoto(JPEG, { date: "2026-10-10", transaction_id: tx });
      const out = text(await callTool("list_photos", { date: "2026-10-10", transaction_id: tx }));
      expect(out.photos.map((p: { id: string }) => p.id)).toEqual([a]);
    });

    it("写真が無ければ空配列", async () => {
      expect(text(await callTool("list_photos", { date: "2026-10-10" }))).toMatchObject({ ok: true, count: 0, photos: [] });
    });

    it("何も指定しないとエラー、存在しない参照先もエラー", async () => {
      const none = await callTool("list_photos", {});
      expect(none.body.result.isError).toBe(true);
      expect(text(none)).toMatchObject({ ok: false });
      const missing = await callTool("list_photos", { transaction_id: "no-tx" });
      expect(missing.body.result.isError).toBe(true);
      expect(text(missing)).toMatchObject({ ok: false, errors: [{ field: "transaction_id" }] });
    });
  });

  describe("get_photos", () => {
    it("画像コンテンツ(base64とmimeType)とメタ情報のテキストを返す", async () => {
      const a = await seedPhoto(JPEG, { date: "2026-10-10", caption: "レシート" });
      const b = await seedPhoto(PNG, { date: "2026-10-10" });
      const r = await callTool("get_photos", { ids: [a, b] });
      expect(r.body.result.isError).toBeFalsy();
      const out = text(r);
      expect(out.ok).toBe(true);
      expect(out.photos).toHaveLength(2);
      expect(out.photos[0]).toMatchObject({ id: a, caption: "レシート", content_type: "image/jpeg", size: JPEG.byteLength });
      expect(images(r)).toEqual([
        { type: "image", data: toBase64(JPEG), mimeType: "image/jpeg" },
        { type: "image", data: toBase64(PNG), mimeType: "image/png" },
      ]);
    });

    it("存在しないidは、他が取れていてもエラーとして明記する", async () => {
      const a = await seedPhoto(JPEG, { date: "2026-10-10" });
      const r = await callTool("get_photos", { ids: [a, "no-such-photo"] });
      expect(r.body.result.isError).toBe(true);
      expect(images(r)).toHaveLength(1);
      const out = text(r);
      expect(out.ok).toBe(false);
      expect(out.photos).toHaveLength(1);
      expect(out.errors).toEqual([{ field: "ids", message: expect.stringContaining("no-such-photo") }]);
    });

    it("全部存在しなければ画像なしのエラー", async () => {
      const r = await callTool("get_photos", { ids: ["x"] });
      expect(r.body.result.isError).toBe(true);
      expect(images(r)).toHaveLength(0);
    });

    it("同じidの重複は1回だけ返す", async () => {
      const a = await seedPhoto(JPEG, { date: "2026-10-10" });
      const r = await callTool("get_photos", { ids: [a, a] });
      expect(images(r)).toHaveLength(1);
    });

    it("idsは1〜4個", async () => {
      const zero = await callTool("get_photos", { ids: [] });
      expect(zero.body.result.isError).toBe(true);
      const five = await callTool("get_photos", { ids: ["1", "2", "3", "4", "5"] });
      expect(five.body.result.isError).toBe(true);
    });

    it("合計が約6MBを超える分は返さず、理由を書く", async () => {
      // 4MB の JPEG(先頭だけ本物のマジックナンバー)を2枚と小さい1枚: 2枚目で超えるので飛ばす
      const big = new Uint8Array(4 * 1024 * 1024);
      big.set(JPEG);
      const ids = [
        await seedPhoto(big, { date: "2026-10-10" }),
        await seedPhoto(big, { date: "2026-10-10" }),
        await seedPhoto(JPEG, { date: "2026-10-10" }),
      ];
      const r = await callTool("get_photos", { ids });
      const out = text(r);
      expect(images(r)).toHaveLength(2);
      expect(out.skipped).toHaveLength(1);
      expect(out.skipped[0].id).toBe(ids[1]);
      expect(out.skipped[0].reason).toContain("6MB");
      expect(out.photos.map((p: { id: string }) => p.id)).toEqual([ids[0], ids[2]]);
    });

    it("保存時のContent-Type以外(想定外)は画像として返さない", async () => {
      const a = await seedPhoto(JPEG, { date: "2026-10-10" });
      const row = await testEnv().DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(a).first<{ r2_key: string }>();
      await testEnv().PHOTOS.put(row!.r2_key, JPEG, { httpMetadata: { contentType: "text/html" } });
      const r = await callTool("get_photos", { ids: [a] });
      expect(r.body.result.isError).toBe(true);
      expect(images(r)).toHaveLength(0);
    });
  });
});
