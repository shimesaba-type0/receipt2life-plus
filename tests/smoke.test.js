import { test } from "node:test";
import assert from "node:assert/strict";

// CIが動くことを確認するための仮のテスト。フェーズ1でvitestに置き換える
test("smoke", () => {
  assert.equal(1 + 1, 2);
});
