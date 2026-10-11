import { describe, expect, it } from "vitest";
import { addEvent, deleteEvent } from "../../src/core/events";
import { deletePhoto, detectImageType, getPhoto, MAX_PHOTO_BYTES, savePhoto } from "../../src/core/photos";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const env = () => testEnv();

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

async function listKeys() {
  return (await env().PHOTOS.list({ prefix: "photos/" })).objects.map((o) => o.key);
}

describe("detectImageType", () => {
  it("先頭のバイト列でJPEG/PNG/WebPを判定する", () => {
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(WEBP)).toBe("image/webp");
  });

  it("画像でないもの(GIF、HTML、短すぎるもの)は null", () => {
    expect(detectImageType(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(detectImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    // RIFF だが WEBP ではない(WAV など)
    expect(detectImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });
});

describe("savePhoto", () => {
  it("R2 に photos/<YYYY>/<uuid> で保存し、行を作る", async () => {
    const res = await savePhoto(env().DB, env().PHOTOS, buf(JPEG), { date: "2026-10-10", caption: "朝食" }, { now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.photo).toMatchObject({ date: "2026-10-10", caption: "朝食", transaction_id: null, event_id: null, url: `/api/photos/${res.photo.id}` });
    const row = await env().DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(res.photo.id).first<{ r2_key: string }>();
    expect(row?.r2_key).toBe(`photos/2026/${res.photo.id}`);
    const object = await env().PHOTOS.get(row!.r2_key);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("紐づけ先が1つもなければ 400", async () => {
    const res = await savePhoto(env().DB, env().PHOTOS, buf(JPEG), { caption: "だけ" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(await listKeys()).toHaveLength(0);
  });

  it("画像でなければ 400。申告のContent-Typeや名前は関係ない(バイト列だけを見る)", async () => {
    const res = await savePhoto(env().DB, env().PHOTOS, new TextEncoder().encode("<script>alert(1)</script>").buffer as ArrayBuffer, { date: "2026-10-10" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.errors[0]?.field).toBe("file");
    expect(await listKeys()).toHaveLength(0);
  });

  it("5MBを超えると 413、ちょうど5MBは通る", async () => {
    const make = (n: number) => {
      const b = new Uint8Array(n);
      b.set(PNG);
      return b.buffer as ArrayBuffer;
    };
    const over = await savePhoto(env().DB, env().PHOTOS, make(MAX_PHOTO_BYTES + 1), { date: "2026-10-10" });
    expect(over).toMatchObject({ ok: false, status: 413 });
    const exact = await savePhoto(env().DB, env().PHOTOS, make(MAX_PHOTO_BYTES), { date: "2026-10-10" });
    expect(exact.ok).toBe(true);
  });

  it("存在しない取引・出来事への紐づけは 400 で、R2 にも残さない", async () => {
    const res = await savePhoto(env().DB, env().PHOTOS, buf(PNG), { transaction_id: "nope", event_id: "nope2" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.errors.map((e) => e.field).sort()).toEqual(["event_id", "transaction_id"]);
    expect(await listKeys()).toHaveLength(0);
  });

  it("行の作成に失敗したら、R2 のオブジェクトを消す", async () => {
    // 外部キーを通した後で行の作成だけ失敗させるため、DB の insert を壊したラッパーを渡す
    const real = env().DB;
    const broken = new Proxy(real, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.startsWith("INSERT INTO attachments")) throw new Error("boom");
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await expect(savePhoto(broken, env().PHOTOS, buf(PNG), { date: "2026-10-10" })).rejects.toThrow("boom");
    expect(await listKeys()).toHaveLength(0);
  });
});

describe("getPhoto / deletePhoto", () => {
  it("保存した値で読み出せる。無ければ 404", async () => {
    const saved = await savePhoto(env().DB, env().PHOTOS, buf(WEBP), { date: "2026-10-10" });
    if (!saved.ok) throw new Error("save failed");
    const got = await getPhoto(env().DB, env().PHOTOS, saved.photo.id);
    expect(got).toMatchObject({ ok: true, contentType: "image/webp", size: WEBP.length });
    expect(await getPhoto(env().DB, env().PHOTOS, "missing")).toMatchObject({ ok: false, status: 404 });
  });

  it("削除は R2 と行の両方を消す", async () => {
    const saved = await savePhoto(env().DB, env().PHOTOS, buf(PNG), { date: "2026-10-10" });
    if (!saved.ok) throw new Error("save failed");
    const res = await deletePhoto(env().DB, env().PHOTOS, saved.photo.id);
    expect(res.ok).toBe(true);
    expect(await listKeys()).toHaveLength(0);
    const row = await env().DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(saved.photo.id).first();
    expect(row).toBeNull();
    expect(await deletePhoto(env().DB, env().PHOTOS, saved.photo.id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("deleteEvent", () => {
  it("削除できる。存在しなければエラー", async () => {
    const e = await addEvent(env().DB, { title: "出張", start_date: "2026-10-03" }, { now: NOW });
    if (!e.ok) throw new Error("add failed");
    const res = await deleteEvent(env().DB, { id: e.event.id });
    expect(res).toMatchObject({ ok: true, deleted: { title: "出張" } });
    expect(await deleteEvent(env().DB, { id: e.event.id })).toMatchObject({ ok: false });
  });

  it("写真が紐づく出来事は断る", async () => {
    const e = await addEvent(env().DB, { title: "旅行", start_date: "2026-10-03" }, { now: NOW });
    if (!e.ok) throw new Error("add failed");
    await savePhoto(env().DB, env().PHOTOS, buf(JPEG), { event_id: e.event.id });
    const res = await deleteEvent(env().DB, { id: e.event.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.message).toContain("写真が1枚紐づいている");
  });

  it("取引に紐づけた写真を保存できる", async () => {
    const t = await addTransactions(env().DB, { transactions: [{ date: "2026-10-10", amount: 100, merchant: "A店", category: "食費" }] }, { now: NOW });
    if (!t.ok) throw new Error("add failed");
    const saved = await savePhoto(env().DB, env().PHOTOS, buf(JPEG), { transaction_id: t.registered[0]!.id });
    expect(saved.ok).toBe(true);
  });
});
