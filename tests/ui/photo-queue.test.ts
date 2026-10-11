import { describe, expect, it } from "vitest";
import {
  MAX_FILES_PER_BATCH,
  MAX_UPLOAD_BYTES,
  planUploads,
  runWithLimit,
  statusLabel,
  summarizeResults,
  validateImageFile,
} from "../../ui/src/photo-queue";

const f = (name: string, type = "image/jpeg", size = 1000) => ({ name, type, size });

describe("runWithLimit", () => {
  it("同時実行数を上限までに絞り、結果は入力順で返す", async () => {
    let running = 0;
    let peak = 0;
    const out = await runWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 * (8 - n)));
      running--;
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });
  it("1件が例外でも残りは続け、その結果は rejected で返す", async () => {
    const out = await runWithLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(out[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(out[1]?.status).toBe("rejected");
    expect(out[2]).toEqual({ status: "fulfilled", value: 3 });
  });
  it("空配列でも完了し、limit が不正なら1として扱う", async () => {
    expect(await runWithLimit([], 2, async () => 1)).toEqual([]);
    let running = 0;
    let peak = 0;
    const out = await runWithLimit([1, 2, 3], 0, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
      return n;
    });
    expect(peak).toBe(1);
    expect(out).toHaveLength(3);
  });
  it("worker に index が渡る", async () => {
    const seen: number[] = [];
    await runWithLimit(["a", "b"], 1, async (_, i) => void seen.push(i));
    expect(seen).toEqual([0, 1]);
  });
});

describe("validateImageFile", () => {
  it("JPEG/PNG/WebP の5MB以内は通す", () => {
    expect(validateImageFile(f("a.jpg", "image/jpeg"))).toBeNull();
    expect(validateImageFile(f("a.png", "image/png"))).toBeNull();
    expect(validateImageFile(f("a.webp", "image/webp", MAX_UPLOAD_BYTES))).toBeNull();
  });
  it("画像以外は理由つきで弾く", () => {
    expect(validateImageFile(f("a.pdf", "application/pdf"))).toContain("画像");
    expect(validateImageFile(f("a.gif", "image/gif"))).toContain("JPEG");
    expect(validateImageFile(f("a", ""))).not.toBeNull();
  });
  it("5MB超は弾く", () => {
    expect(validateImageFile(f("big.jpg", "image/jpeg", MAX_UPLOAD_BYTES + 1))).toContain("5MB");
  });
  it("空ファイルは弾く", () => {
    expect(validateImageFile(f("e.jpg", "image/jpeg", 0))).not.toBeNull();
  });
});

describe("planUploads", () => {
  it("問題ないものは accepted に、弾いたものは理由つきで rejected に入る", () => {
    const files = [f("a.jpg"), f("b.pdf", "application/pdf"), f("c.png", "image/png")];
    const plan = planUploads(files);
    expect(plan.accepted.map((x) => x.name)).toEqual(["a.jpg", "c.png"]);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0]?.name).toBe("b.pdf");
  });
  it("1回20枚まで。超過分は理由つきで弾く", () => {
    const files = Array.from({ length: MAX_FILES_PER_BATCH + 3 }, (_, i) => f(`p${i}.jpg`));
    const plan = planUploads(files);
    expect(plan.accepted).toHaveLength(MAX_FILES_PER_BATCH);
    expect(plan.rejected).toHaveLength(3);
    expect(plan.rejected[0]?.reason).toContain("20枚");
  });
  it("検査で弾かれた分は20枚の枠を使わない", () => {
    const files = [f("x.pdf", "application/pdf"), ...Array.from({ length: MAX_FILES_PER_BATCH }, (_, i) => f(`p${i}.jpg`))];
    const plan = planUploads(files);
    expect(plan.accepted).toHaveLength(MAX_FILES_PER_BATCH);
    expect(plan.rejected).toHaveLength(1);
  });
});

describe("summarizeResults", () => {
  it("成功と失敗を数え、失敗の名前と理由を返す", () => {
    const s = summarizeResults("追加", [
      { name: "a.jpg", error: null },
      { name: "b.jpg", error: "写真が大きすぎます" },
      { name: "c.jpg", error: null },
    ]);
    expect(s).toEqual({ ok: 2, failed: 1, message: "2枚追加、1枚失敗", failures: [{ name: "b.jpg", reason: "写真が大きすぎます" }] });
  });
  it("全部成功なら失敗の文言を出さない", () => {
    expect(summarizeResults("削除", [{ name: "a", error: null }]).message).toBe("1枚削除");
  });
  it("全部失敗でも出せる", () => {
    expect(summarizeResults("追加", [{ name: "a", error: "x" }]).message).toBe("0枚追加、1枚失敗");
  });
});

describe("statusLabel", () => {
  it("状態を日本語にする", () => {
    expect(statusLabel("waiting")).toBe("待機中");
    expect(statusLabel("resizing")).toBe("縮小中");
    expect(statusLabel("uploading")).toBe("送信中");
    expect(statusLabel("done")).toBe("完了");
    expect(statusLabel("failed")).toBe("失敗");
  });
});
