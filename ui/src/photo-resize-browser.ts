// Canvas を使う縮小(ブラウザ専用。純関数は photo-resize.ts でテストする)
import { QUALITY, computeResizedSize, pickOutputType } from "./photo-resize";

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// 画像ファイルを長辺1600px以内の WebP(非対応なら JPEG)にする。失敗したら日本語のメッセージで例外
export async function resizePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("画像を読み込めませんでした。JPEG・PNG・WebP の画像を選んでください。");
  }
  try {
    const size = computeResizedSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("この端末では画像を縮小できませんでした。");
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    // WebP 非対応のブラウザは、指定しても PNG が返るので、返ったタイプで判定する
    let blob = await toBlob(canvas, "image/webp", QUALITY);
    if (!blob || pickOutputType(blob.type === "image/webp") !== "image/webp") {
      blob = await toBlob(canvas, "image/jpeg", QUALITY);
    }
    if (!blob) throw new Error("画像の縮小に失敗しました。");
    return blob;
  } finally {
    bitmap.close();
  }
}
