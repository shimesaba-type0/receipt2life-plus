// 圧縮なし(store)の ZIP を作る・読む。外部のライブラリは使わない(写真は、すでに圧縮された形式なので、圧縮しても小さくならない)
// 作る: 1つの ZIP は4GB未満・65,535ファイル未満(呼び出し側で、100MB・500ファイルずつに分ける)。ファイル名は UTF-8
// 読む: このアプリが作った ZIP(圧縮なし)だけ。圧縮された ZIP は、分かりやすいエラーにする

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

let table: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (table) return table;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  table = t;
  return t;
}

/** CRC-32(ZIP の検査値) */
export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 日時(DOS 形式)。1980年より前は 1980-01-01 にする
function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipBuilder {
  private parts: Uint8Array[] = [];
  private entries: Entry[] = [];
  private offset = 0;
  private readonly stamp: { time: number; date: number };

  constructor(now: Date = new Date()) {
    this.stamp = dosDateTime(now);
  }

  get fileCount(): number {
    return this.entries.length;
  }

  /** いまの、ファイルの中身の合計(バイト) */
  get byteSize(): number {
    return this.offset;
  }

  add(name: string, data: Uint8Array): void {
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 0xffff) throw new Error("ファイル名が長すぎます");
    if (this.entries.length >= 0xfffe) throw new Error("1つの ZIP に入れられるファイル数を超えました");
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // 必要なバージョン
    v.setUint16(6, 0x0800, true); // UTF-8 のファイル名
    v.setUint16(8, 0, true); // 圧縮なし
    v.setUint16(10, this.stamp.time, true);
    v.setUint16(12, this.stamp.date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    this.entries.push({ name: nameBytes, crc, size: data.length, offset: this.offset, time: this.stamp.time, date: this.stamp.date });
    this.parts.push(header, data);
    this.offset += header.length + data.length;
    if (this.offset > 0xffffffff - 1024 * 1024) throw new Error("1つの ZIP が大きすぎます");
  }

  /** ZIP を完成させて、Blob で返す */
  finish(): Blob {
    const central: Uint8Array[] = [];
    let centralSize = 0;
    for (const e of this.entries) {
      const h = new Uint8Array(46 + e.name.length);
      const v = new DataView(h.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true); // 作ったバージョン
      v.setUint16(6, 20, true); // 必要なバージョン
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, e.time, true);
      v.setUint16(14, e.date, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.size, true);
      v.setUint32(24, e.size, true);
      v.setUint16(28, e.name.length, true);
      v.setUint32(42, e.offset, true);
      h.set(e.name, 46);
      central.push(h);
      centralSize += h.length;
    }
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.entries.length, true);
    v.setUint16(10, this.entries.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...central, end] as ArrayBufferView<ArrayBuffer>[], { type: "application/zip" });
  }
}

export interface ZipEntry {
  name: string;
  size: number;
  /** 中身を読む(検査値も確かめる) */
  read(): Promise<Uint8Array>;
}

export class ZipError extends Error {}

/** ZIP(Blob)の、ファイルの一覧を読む。中身は、read() で、必要なときに読む */
export async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size;
  if (size < 22) throw new ZipError("ZIP ファイルとして読めません");
  // 末尾の「終端」を探す(コメントがあっても見つかるよう、最大 64KB+22 バイトを見る)
  const tailLength = Math.min(size, 22 + 0xffff);
  const tail = new Uint8Array(await blob.slice(size - tailLength, size).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("ZIP ファイルとして読めません");
  const count = tv.getUint16(eocd + 10, true);
  const centralSize = tv.getUint32(eocd + 12, true);
  const centralOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new ZipError("大きすぎる ZIP(ZIP64)は読めません");
  if (centralOffset + centralSize > size) throw new ZipError("ZIP ファイルが壊れています");
  const central = new Uint8Array(await blob.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const cv = new DataView(central.buffer);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > central.length || cv.getUint32(p, true) !== 0x02014b50) throw new ZipError("ZIP ファイルが壊れています");
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    const crc = cv.getUint32(p + 16, true);
    const compressed = cv.getUint32(p + 20, true);
    const uncompressed = cv.getUint32(p + 24, true);
    const nameLength = cv.getUint16(p + 28, true);
    const extraLength = cv.getUint16(p + 30, true);
    const commentLength = cv.getUint16(p + 32, true);
    const localOffset = cv.getUint32(p + 42, true);
    const name = decoder.decode(central.slice(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new ZipError("パスワードつきの ZIP は読めません");
    if (method !== 0) throw new ZipError("圧縮された ZIP は読めません。このアプリが作った ZIP を選んでください");
    if (name.endsWith("/")) continue; // フォルダ
    entries.push({
      name,
      size: uncompressed,
      async read() {
        const local = new Uint8Array(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
        const lv = new DataView(local.buffer);
        if (local.length < 30 || lv.getUint32(0, true) !== 0x04034b50) throw new ZipError("ZIP ファイルが壊れています");
        const start = localOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
        const data = new Uint8Array(await blob.slice(start, start + compressed).arrayBuffer());
        if (data.length !== uncompressed || crc32(data) !== crc) throw new ZipError(`「${name}」の中身が壊れています(検査値が合いません)`);
        return data;
      },
    });
  }
  return entries;
}
