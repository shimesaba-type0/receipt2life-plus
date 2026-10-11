import { describe, expect, it } from "vitest";
import { listCategories } from "../../src/core/categories";
import { testEnv } from "../helpers";

describe("listCategories", () => {
  it("カテゴリと口座を、登録順で返す", async () => {
    const res = await listCategories(testEnv().DB);
    expect(res.ok).toBe(true);
    expect(res.categories).toEqual([
      { name: "食費", group_name: "食費" },
      { name: "日用品", group_name: "生活" },
      { name: "交通・チャージ", group_name: "交通" },
      { name: "娯楽", group_name: "娯楽" },
      { name: "その他", group_name: "その他" },
    ]);
    expect(res.accounts).toEqual(["現金", "カード", "Suica"]);
    expect(res.message).toContain("食費");
    expect(res.message).toContain("Suica");
  });

  it("呼ぶたびに同じ順で返す", async () => {
    const a = await listCategories(testEnv().DB);
    const b = await listCategories(testEnv().DB);
    expect(b).toEqual(a);
  });
});
