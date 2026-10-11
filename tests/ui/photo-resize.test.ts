import { describe, expect, it } from "vitest";
import { MAX_EDGE, computeResizedSize, pickOutputType } from "../../ui/src/photo-resize";

describe("computeResizedSize", () => {
  it("長辺が上限以下なら拡大も縮小もしない", () => {
    expect(computeResizedSize(800, 600)).toEqual({ width: 800, height: 600, resized: false });
    expect(computeResizedSize(MAX_EDGE, 100)).toEqual({ width: MAX_EDGE, height: 100, resized: false });
  });
  it("横長は幅を1600にしてアスペクト比を保つ", () => {
    expect(computeResizedSize(3200, 2400)).toEqual({ width: 1600, height: 1200, resized: true });
  });
  it("縦長は高さを1600にする", () => {
    expect(computeResizedSize(3000, 4000)).toEqual({ width: 1200, height: 1600, resized: true });
  });
  it("丸めても1px未満にならない", () => {
    expect(computeResizedSize(10000, 3)).toEqual({ width: 1600, height: 1, resized: true });
  });
  it("上限を指定できる", () => {
    expect(computeResizedSize(1000, 500, 500)).toEqual({ width: 500, height: 250, resized: true });
  });
  it("不正な寸法は例外", () => {
    expect(() => computeResizedSize(0, 100)).toThrow();
    expect(() => computeResizedSize(100, Number.NaN)).toThrow();
  });
});

describe("pickOutputType", () => {
  it("WebP を書き出せるなら WebP、だめなら JPEG", () => {
    expect(pickOutputType(true)).toBe("image/webp");
    expect(pickOutputType(false)).toBe("image/jpeg");
  });
});
