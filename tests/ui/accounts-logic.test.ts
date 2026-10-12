import { describe, expect, it } from "vitest";
import type { AccountView } from "../../src/api/contract";
import { MAX_ACCOUNT_NAME, accountMoveTargets, checkAccountRename, checkNewAccount, defaultAccountMoveTarget, needsOtherAccount } from "../../ui/src/pages/accountsLogic";

const acc = (name: string, usage = 0): AccountView => ({ name, usage });
const sample = [acc("現金", 2), acc("カード"), acc("Suica", 1)];

describe("checkNewAccount", () => {
  it("前後の空白を取り除く。空・長すぎる・「.」だけ・重複は断る", () => {
    expect(checkNewAccount(sample, "  電子マネーA ")).toEqual({ ok: true, value: "電子マネーA" });
    expect(checkNewAccount(sample, "  ")).toMatchObject({ ok: false });
    expect(checkNewAccount(sample, "あ".repeat(MAX_ACCOUNT_NAME + 1))).toMatchObject({ ok: false });
    expect(checkNewAccount(sample, "あ".repeat(MAX_ACCOUNT_NAME))).toMatchObject({ ok: true });
    expect(checkNewAccount(sample, "..")).toMatchObject({ ok: false });
    expect(checkNewAccount(sample, " 現金 ")).toEqual({ ok: false, error: "「現金」という口座は既にあります" });
  });
  it("上限はカテゴリ名と同じ30", () => {
    expect(MAX_ACCOUNT_NAME).toBe(30);
  });
});

describe("checkAccountRename", () => {
  it("今と同じ名前は変更なし、他の口座と同じ名前は重複", () => {
    expect(checkAccountRename(sample, "現金", " 現金 ")).toEqual({ ok: false, error: "変更がありません" });
    expect(checkAccountRename(sample, "現金", "カード")).toMatchObject({ ok: false });
    expect(checkAccountRename(sample, "現金", " 財布 ")).toEqual({ ok: true, value: "財布" });
    expect(checkAccountRename(sample, "現金", "")).toMatchObject({ ok: false });
  });
});

describe("削除の付け替え先", () => {
  it("自分を除く。初期値は先頭の候補、無ければ空", () => {
    expect(accountMoveTargets(sample, "現金").map((a) => a.name)).toEqual(["カード", "Suica"]);
    expect(defaultAccountMoveTarget(sample, "現金")).toBe("カード");
    expect(defaultAccountMoveTarget([acc("現金")], "現金")).toBe("");
  });
  it("使用中で他に口座が無いときだけ、削除をふさぐ", () => {
    expect(needsOtherAccount([acc("現金", 1)], "現金")).toBe(true);
    expect(needsOtherAccount([acc("現金", 0)], "現金")).toBe(false);
    expect(needsOtherAccount(sample, "現金")).toBe(false);
  });
});
