import { describe, expect, it } from "vitest";
import { ShortCache } from "../../ui/src/api-cache";

type R = { ok: boolean; n: number };
const ok = (r: R) => r.ok;

function setup(ttl = 1000) {
  let t = 0;
  const cache = new ShortCache<R>(ttl, () => t);
  let calls = 0;
  const load = (value: Partial<R> = {}) => async () => ({ ok: true, n: ++calls, ...value });
  return { cache, load, advance: (ms: number) => (t += ms), calls: () => calls };
}

describe("ShortCache", () => {
  it("TTL の間は、同じキーを取りに行かず、おぼえた値を返す", async () => {
    const s = setup();
    const a = await s.cache.get("k", s.load(), ok);
    s.advance(999);
    const b = await s.cache.get("k", s.load(), ok);
    expect(b).toEqual(a);
    expect(s.calls()).toBe(1);
  });

  it("TTL を過ぎたら取り直す", async () => {
    const s = setup();
    await s.cache.get("k", s.load(), ok);
    s.advance(1000);
    const b = await s.cache.get("k", s.load(), ok);
    expect(b.n).toBe(2);
  });

  it("キーが違えば別に取る", async () => {
    const s = setup();
    await s.cache.get("a", s.load(), ok);
    await s.cache.get("b", s.load(), ok);
    expect(s.calls()).toBe(2);
  });

  it("失敗(ok でない結果)はおぼえない", async () => {
    const s = setup();
    await s.cache.get("k", s.load({ ok: false }), ok);
    const b = await s.cache.get("k", s.load(), ok);
    expect(b.n).toBe(2);
  });

  it("例外はおぼえず、次は取り直す", async () => {
    const s = setup();
    await expect(s.cache.get("k", async () => Promise.reject(new Error("x")), ok)).rejects.toThrow("x");
    const b = await s.cache.get("k", s.load(), ok);
    expect(b.n).toBe(1);
  });

  it("clear するとすべて捨てる", async () => {
    const s = setup();
    await s.cache.get("a", s.load(), ok);
    await s.cache.get("b", s.load(), ok);
    expect(s.cache.size).toBe(2);
    s.cache.clear();
    expect(s.cache.size).toBe(0);
    await s.cache.get("a", s.load(), ok);
    expect(s.calls()).toBe(3);
  });

  it("同じキーが飛行中なら、通信を1回に共有する", async () => {
    const s = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const slow = async () => {
      calls++;
      await gate;
      return { ok: true, n: 1 };
    };
    const p1 = s.cache.get("k", slow, ok);
    const p2 = s.cache.get("k", slow, ok);
    release();
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });

  it("clear より前に始まった通信の結果は、おぼえない(古い値を戻さない)", async () => {
    const s = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      await gate;
      return { ok: true, n: 99 };
    };
    const p = s.cache.get("k", slow, ok);
    s.cache.clear(); // 書き込みがあった
    release();
    await p;
    expect(s.cache.size).toBe(0);
    const b = await s.cache.get("k", s.load(), ok);
    expect(b.n).toBe(1);
  });

  it("件数が上限を超えたら、いちばん古いものを捨てる", async () => {
    const s = setup(1_000_000);
    for (let i = 0; i < 101; i++) await s.cache.get(`k${i}`, s.load(), ok);
    expect(s.cache.size).toBe(100);
    const before = s.calls();
    await s.cache.get("k0", s.load(), ok); // 捨てられたので取り直す
    expect(s.calls()).toBe(before + 1);
  });
});
