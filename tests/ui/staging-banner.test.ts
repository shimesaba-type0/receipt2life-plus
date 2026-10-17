import { describe, expect, it } from "vitest";
import { stagingLabel } from "../../ui/src/stagingBanner";

describe("ステージングの目印の帯", () => {
  it("変数が無い・空・文字列でないときは、帯を出さない(本番のビルドは、この状態)", () => {
    expect(stagingLabel(undefined)).toBeNull();
    expect(stagingLabel("")).toBeNull();
    expect(stagingLabel("   ")).toBeNull();
    expect(stagingLabel(123)).toBeNull();
    expect(stagingLabel(true)).toBeNull();
  });

  it("文言があれば、前後の空白を取って返す。長すぎる文言は60文字で切る", () => {
    expect(stagingLabel(" PR #87 · abc1234 ")).toBe("PR #87 · abc1234");
    expect(stagingLabel("あ".repeat(100))).toHaveLength(60);
  });
});
