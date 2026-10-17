import { describe, expect, it } from "vitest";
import {
  buildPhotoZips,
  parsePhotoRecords,
  photoFileName,
  photoIdFromFileName,
  PHOTO_LIST_FILE,
  restorePhotos,
  type FetchedPhoto,
  type PhotoRecord,
  type PutResult,
} from "../../ui/src/photoBackup";
import { readZip } from "../../ui/src/zip";

const rec = (id: string): PhotoRecord => ({ id, date: "2026-10-10", caption: "朝食", transaction_id: null, event_id: null, created_at: "2026-10-10T00:00:00.000Z" });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("書き出し(JSONL)からの写真の一覧", () => {
  it("attachment の行だけを取り出す。壊れた行・id のない行・空行は飛ばす", () => {
    const jsonl = [
      JSON.stringify({ type: "event", id: "e1" }),
      JSON.stringify({ type: "attachment", id: "p1", r2_key: "photos/2026/p1", date: "2026-10-10", caption: "朝食", transaction_id: "t1", created_at: "2026-10-10T00:00:00.000Z" }),
      "",
      "not json",
      JSON.stringify({ type: "attachment", r2_key: "photos/2026/x" }),
      JSON.stringify({ type: "attachment", id: "p2", date: "2026-10-11" }),
    ].join("\n");
    expect(parsePhotoRecords(jsonl)).toEqual([
      { id: "p1", date: "2026-10-10", caption: "朝食", transaction_id: "t1", event_id: null, created_at: "2026-10-10T00:00:00.000Z" },
      { id: "p2", date: "2026-10-11", caption: null, transaction_id: null, event_id: null, created_at: null },
    ]);
  });
});

describe("ファイル名と id", () => {
  it("画像の形式から拡張子を付け、ZIP の中の名前から id を戻す", () => {
    expect(photoFileName("abc-1", "image/jpeg")).toBe("abc-1.jpg");
    expect(photoFileName("abc-1", "image/webp; charset=x")).toBe("abc-1.webp");
    expect(photoFileName("abc-1", "")).toBe("abc-1.bin");
    expect(photoIdFromFileName("abc-1.jpg")).toBe("abc-1");
    expect(photoIdFromFileName("dir/abc_2.WEBP")).toBe("abc_2");
    expect(photoIdFromFileName(PHOTO_LIST_FILE)).toBeNull();
    expect(photoIdFromFileName("note.txt")).toBeNull();
    expect(photoIdFromFileName("../../evil.jpg")).toBe("evil");
    expect(photoIdFromFileName("a b.jpg")).toBeNull();
    expect(photoIdFromFileName(`${"a".repeat(65)}.jpg`)).toBeNull();
  });
});

describe("buildPhotoZips(写真を ZIP にまとめる)", () => {
  const fetchOk = async (): Promise<FetchedPhoto> => ({ ok: true, bytes: JPEG, contentType: "image/jpeg" });

  it("写真と、一覧(photos.json)を入れた ZIP を作る。取り出せなかった写真は、理由つきで数える", async () => {
    const parts: Blob[] = [];
    const summary = await buildPhotoZips([rec("p1"), rec("p2"), rec("p3")], async (id) => (id === "p2" ? { ok: false, reason: "画像の実体が見つかりません" } : fetchOk()), { onPart: (p) => void parts.push(p.blob) });
    expect(summary).toMatchObject({ total: 3, saved: 2, parts: 1, failed: [{ id: "p2", reason: "画像の実体が見つかりません" }] });
    const entries = await readZip(parts[0]!);
    expect(entries.map((e) => e.name)).toEqual(["p1.jpg", "p3.jpg", PHOTO_LIST_FILE]);
    const list = JSON.parse(new TextDecoder().decode(await entries[2]!.read())) as { file: string; id: string; caption: string }[];
    expect(list.map((l) => [l.file, l.id, l.caption])).toEqual([["p1.jpg", "p1", "朝食"], ["p3.jpg", "p3", "朝食"]]);
  });

  it("枚数・バイト数で、別のファイルに分ける。進み具合を知らせる", async () => {
    const parts: { index: number; files: number }[] = [];
    const progress: string[] = [];
    const ids = ["a", "b", "c", "d", "e"];
    const summary = await buildPhotoZips(ids.map(rec), fetchOk, { onPart: (p) => void parts.push({ index: p.index, files: p.files }), onProgress: (d, t) => progress.push(`${d}/${t}`) }, { maxFiles: 2 });
    expect(summary.parts).toBe(3);
    expect(parts).toEqual([{ index: 1, files: 2 }, { index: 2, files: 2 }, { index: 3, files: 1 }]);
    expect(progress[0]).toBe("0/5");
    expect(progress.at(-1)).toBe("5/5");

    const bytesParts: number[] = [];
    await buildPhotoZips(ids.map(rec), fetchOk, { onPart: (p) => void bytesParts.push(p.files) }, { maxBytes: 90 });
    expect(bytesParts).toEqual([2, 2, 1]);
  });

  it("写真がなければ、ZIP は作らない", async () => {
    let n = 0;
    const summary = await buildPhotoZips([], fetchOk, { onPart: () => void n++ });
    expect(n).toBe(0);
    expect(summary).toMatchObject({ total: 0, saved: 0, parts: 0 });
  });
});

describe("restorePhotos(ZIP の写真を戻す)", () => {
  async function entriesOf(ids: string[]) {
    const parts: Blob[] = [];
    await buildPhotoZips(ids.map(rec), async () => ({ ok: true, bytes: JPEG, contentType: "image/jpeg" }), { onPart: (p) => void parts.push(p.blob) });
    return readZip(parts[0]!);
  }
  const noSleep = async () => undefined;

  it("写真のファイルだけを、1枚ずつ戻す(photos.json は送らない)。結果を数える", async () => {
    const entries = await entriesOf(["p1", "p2", "p3", "p4"]);
    const put = async (id: string): Promise<PutResult> => {
      if (id === "p2") return { ok: true, status: "exists" };
      if (id === "p3") return { ok: false, status: 404, error: "情報がない" };
      if (id === "p4") return { ok: false, status: 400, error: "画像の形式が分かりません" };
      return { ok: true, status: "restored" };
    };
    const sent: string[] = [];
    const s = await restorePhotos(entries, async (id, bytes) => (sent.push(id), expect(bytes.length).toBe(JPEG.length), put(id)), { sleep: noSleep });
    expect(sent).toEqual(["p1", "p2", "p3", "p4"]);
    expect(s).toMatchObject({ total: 4, restored: 1, exists: 1, noRecord: 1, stoppedBy: null, failed: [{ name: "p4.jpg", reason: "画像の形式が分かりません" }] });
  });

  it("429 は待って送り直す。通信の失敗(状態0・500)が続くと、そこで止まる", async () => {
    const entries = await entriesOf(["p1", "p2", "p3"]);
    let calls = 0;
    const waits: number[] = [];
    const retry = await restorePhotos(
      entries.slice(0, 1),
      async () => (++calls < 3 ? { ok: false, status: 429, error: "" } : { ok: true, status: "restored" }),
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect(retry.restored).toBe(1);
    expect(waits).toHaveLength(2);

    let n = 0;
    const stopped = await restorePhotos(entries, async () => (++n === 2 ? { ok: false, status: 0, error: "通信に失敗しました" } : { ok: true, status: "restored" }), { sleep: noSleep });
    expect(stopped).toMatchObject({ restored: 1, stoppedBy: "通信に失敗しました" });
    expect(n).toBe(2);
  });
});
