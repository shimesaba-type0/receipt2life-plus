// 写真をアップロード前に縮小する。計算は純関数(テストする)、Canvas を使う部分はブラウザ専用
export const MAX_EDGE = 1600;
export const QUALITY = 0.85;

export interface ResizedSize {
  width: number;
  height: number;
  // false のときは寸法が変わらない(拡大はしない)
  resized: boolean;
}

// 長辺が maxEdge を超えるときだけ、アスペクト比を保って縮小する
export function computeResizedSize(width: number, height: number, maxEdge: number = MAX_EDGE): ResizedSize {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("画像の寸法が不正です");
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height, resized: false };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

export type OutputType = "image/webp" | "image/jpeg";

export function pickOutputType(webpSupported: boolean): OutputType {
  return webpSupported ? "image/webp" : "image/jpeg";
}
