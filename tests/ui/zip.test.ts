import { describe, expect, it } from "vitest";
import { crc32, readZip, ZipBuilder, ZipError } from "../../ui/src/zip";

const enc = (s: string) => new TextEncoder().encode(s);
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe("crc32", () => {
  it("既知の値と一致する(\"123456789\" は 0xCBF43926)", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("ZipBuilder と readZip", () => {
  it("作った ZIP を読み戻せる(日本語のファイル名・バイナリ・空のファイルも)", async () => {
    const z = new ZipBuilder(new Date(2026, 9, 17, 12, 30, 40));
    const bin = new Uint8Array(1000).map((_, i) => (i * 7) % 256);
    z.add("a.jpg", bin);
    z.add("写真/朝食.txt", enc("おはよう"));
    z.add("empty.bin", new Uint8Array(0));
    expect(z.fileCount).toBe(3);
    const entries = await readZip(z.finish());
    expect(entries.map((e) => e.name)).toEqual(["a.jpg", "写真/朝食.txt", "empty.bin"]);
    expect(entries.map((e) => e.size)).toEqual([1000, 12, 0]);
    expect(Array.from(await entries[0]!.read())).toEqual(Array.from(bin));
    expect(new TextDecoder().decode(await entries[1]!.read())).toBe("おはよう");
    expect((await entries[2]!.read()).length).toBe(0);
  });

  it("空の ZIP も作れて、読める(ファイルなし)", async () => {
    expect(await readZip(new ZipBuilder().finish())).toEqual([]);
  });

  it("中身が壊れている(検査値が合わない)ときは、読むときにエラー", async () => {
    const z = new ZipBuilder();
    z.add("x.bin", enc("hello world"));
    const raw = await bytesOf(z.finish());
    // ファイルの中身(30バイトのヘッダ+名前5バイトのあと)を1バイト書き換える
    raw[30 + 5 + 2] = raw[30 + 5 + 2]! ^ 0xff;
    const entries = await readZip(new Blob([raw]));
    await expect(entries[0]!.read()).rejects.toThrow(ZipError);
  });

  it("ZIP でないファイル・短すぎるファイルは、分かりやすいエラー", async () => {
    await expect(readZip(new Blob([enc("not a zip file at all, just some text here.")]))).rejects.toThrow("ZIP ファイルとして読めません");
    await expect(readZip(new Blob([enc("x")]))).rejects.toThrow(ZipError);
  });

  it("圧縮された ZIP(method が 0 でない)は、読めない旨を伝える", async () => {
    const z = new ZipBuilder();
    z.add("x.bin", enc("hello"));
    const raw = await bytesOf(z.finish());
    // 中央ディレクトリの method(オフセット10)を 8(deflate)に書き換える
    const dv = new DataView(raw.buffer);
    let p = -1;
    for (let i = 0; i < raw.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) p = i;
    dv.setUint16(p + 10, 8, true);
    await expect(readZip(new Blob([raw]))).rejects.toThrow("圧縮された ZIP は読めません");
  });
});
