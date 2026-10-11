import { describe, expect, it } from "vitest";
import type { TaxFlag } from "../../src/api/contract";
import { TAX_FLAG_LABELS, TAX_FLAGS } from "../../src/core/tax-flags";
import { TAX_FLAG_OPTIONS, parseTaxFlagField, taxFlagChipLabel } from "../../ui/src/pages/dayLogic";
import { UI_TAX_FLAG_LABELS } from "../../ui/src/taxFlags";

describe("UI のラベル", () => {
  it("core の TAX_FLAG_LABELS と同じ(型は contract の TaxFlag に合う)", () => {
    const flags: TaxFlag[] = [...TAX_FLAGS];
    expect(Object.keys(UI_TAX_FLAG_LABELS)).toEqual(flags);
    expect(UI_TAX_FLAG_LABELS).toEqual(TAX_FLAG_LABELS);
  });
});

describe("dayLogic の税金フラグ", () => {
  it("選択肢は先頭が「なし」で、あとはフラグの順", () => {
    expect(TAX_FLAG_OPTIONS[0]).toEqual({ value: "", label: "なし" });
    expect(TAX_FLAG_OPTIONS.slice(1).map((o) => o.value)).toEqual(["medical", "self_medication", "donation"]);
    expect(TAX_FLAG_OPTIONS[1]?.label).toBe("医療費控除");
  });

  it("フォームの値を TaxFlag | null にする(空・不明は null)", () => {
    expect(parseTaxFlagField("")).toBeNull();
    expect(parseTaxFlagField("medical")).toBe("medical");
    expect(parseTaxFlagField("donation")).toBe("donation");
    expect(parseTaxFlagField("bogus")).toBeNull();
  });

  it("チップの文言。フラグなしは null", () => {
    expect(taxFlagChipLabel("medical")).toBe("医療費控除");
    expect(taxFlagChipLabel("self_medication")).toBe("セルフメディケーション税制");
    expect(taxFlagChipLabel(null)).toBeNull();
    expect(taxFlagChipLabel(undefined)).toBeNull();
  });
});
