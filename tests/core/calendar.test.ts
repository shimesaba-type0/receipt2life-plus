import { describe, expect, it } from "vitest";
import { getCalendar, getDay, monthRange } from "../../src/core/calendar";
import { addEvent } from "../../src/core/events";
import { getHome } from "../../src/core/home";
import { savePhoto } from "../../src/core/photos";
import { addTransactions } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).buffer as ArrayBuffer;

async function tx(items: unknown[]) {
  const res = await addTransactions(db(), { transactions: items }, { now: NOW });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.registered;
}

describe("monthRange", () => {
  it("月末を正しく返す(うるう年も)", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2026-02").to).toBe("2026-02-28");
    expect(monthRange("2028-02").to).toBe("2028-02-29");
  });
});

describe("getCalendar", () => {
  it("取引のある日だけ、合計・件数・写真枚数を返す", async () => {
    const [a] = await tx([
      { date: "2026-10-03", amount: 500, merchant: "A店", category: "食費" },
      { date: "2026-10-03", amount: 300, merchant: "B店", category: "食費" },
      { date: "2026-10-05", amount: 1000, merchant: "C店", category: "食費" },
      { date: "2026-09-30", amount: 999, merchant: "D店", category: "食費" },
    ]);
    // 取引に紐づく写真と、日付に紐づく写真、出来事(10/4〜10/6)に紐づく写真
    await savePhoto(db(), testEnv().PHOTOS, JPEG, { transaction_id: a!.id });
    await savePhoto(db(), testEnv().PHOTOS, JPEG, { date: "2026-10-03" });
    const ev = await addEvent(db(), { title: "出張", start_date: "2026-10-04", end_date: "2026-10-06" }, { now: NOW });
    if (!ev.ok) throw new Error("event");
    await savePhoto(db(), testEnv().PHOTOS, JPEG, { event_id: ev.event.id });

    const res = await getCalendar(db(), "2026-10");
    expect(res).toMatchObject({
      ok: true,
      month: "2026-10",
      total: 1800,
      days: [
        { date: "2026-10-03", total: 800, count: 2, photos: 2 },
        { date: "2026-10-05", total: 1000, count: 1, photos: 1 },
      ],
    });
    if (res.ok) expect(res.events.map((e) => e.title)).toEqual(["出張"]);
  });

  it("month 省略は今月(JST)。不正な月はエラー", async () => {
    const res = await getCalendar(db(), undefined, { now: NOW });
    expect(res).toMatchObject({ ok: true, month: "2026-10" });
    for (const bad of ["2026-13", "2026-1", "abc", "2026-10-01"]) {
      expect(await getCalendar(db(), bad)).toMatchObject({ ok: false, errors: [{ field: "month" }] });
    }
  });

  it("月をまたぐ出来事は、重なる月に出る", async () => {
    await addEvent(db(), { title: "旅行", start_date: "2026-09-29", end_date: "2026-10-02" }, { now: NOW });
    const res = await getCalendar(db(), "2026-10");
    if (!res.ok) throw new Error("calendar");
    expect(res.events).toHaveLength(1);
    expect(res.days).toEqual([]);
  });
});

describe("getDay", () => {
  it("その日の取引・出来事・写真を返す", async () => {
    const [a] = await tx([
      { date: "2026-10-05", amount: 400, merchant: "A店", category: "食費", memo: "ランチ" },
      { date: "2026-10-06", amount: 900, merchant: "B店", category: "食費" },
    ]);
    await addEvent(db(), { title: "出張", start_date: "2026-10-04", end_date: "2026-10-06" }, { now: NOW });
    await savePhoto(db(), testEnv().PHOTOS, JPEG, { transaction_id: a!.id, caption: "レシート" });

    const res = await getDay(db(), "2026-10-05");
    expect(res).toMatchObject({ ok: true, date: "2026-10-05", total: 400, count: 1 });
    if (!res.ok) return;
    expect(res.transactions[0]).toMatchObject({ merchant: "A店", category: "食費", memo: "ランチ" });
    expect(res.events.map((e) => e.title)).toEqual(["出張"]);
    expect(res.photos).toHaveLength(1);
    expect(res.photos[0]).toMatchObject({ caption: "レシート", transaction_id: a!.id });

    const other = await getDay(db(), "2026-10-06");
    if (other.ok) expect(other.photos).toHaveLength(0);
  });

  it("取引のない日は0件で返す。実在しない日付はエラー", async () => {
    expect(await getDay(db(), "2026-10-07")).toMatchObject({ ok: true, total: 0, count: 0, transactions: [] });
    expect(await getDay(db(), "2026-02-30")).toMatchObject({ ok: false, errors: [{ field: "date" }] });
    expect(await getDay(db(), "bad")).toMatchObject({ ok: false });
  });
});

describe("getHome", () => {
  it("今日・今月・大分類・メモ割合・要確認・最近5件を返す", async () => {
    await tx([
      { date: "2026-10-11", amount: 500, merchant: "A店", category: "食費", memo: "メモ" },
      { date: "2026-10-11", amount: 300, merchant: "B店", category: "食費" },
      { date: "2026-10-02", amount: 1200, merchant: "C店" },
      { date: "2026-10-01", amount: 100, merchant: "D店", category: "食費" },
      { date: "2026-09-30", amount: 700, merchant: "E店", category: "食費" },
      { date: "2026-09-29", amount: 50, merchant: "F店", category: "食費" },
    ]);
    const res = await getHome(db(), { now: NOW });
    if (!res.ok) throw new Error("home");
    expect(res.today).toEqual({ date: "2026-10-11", total: 800, count: 2 });
    expect(res.month).toEqual({ month: "2026-10", from: "2026-10-01", to: "2026-10-31", total: 2100, count: 4 });
    expect(res.groups.reduce((s, g) => s + g.total, 0)).toBe(2100);
    expect(res.memo).toEqual({ with_memo: 1, total: 4, percent: 25 });
    expect(res.needs_review).toBe(1);
    expect(res.recent).toHaveLength(6);
  });

  it("最近の記録は、購入日ではなく登録した順(新しい順)に並ぶ", async () => {
    await tx([
      { date: "2026-10-11", amount: 500, merchant: "新しい日付の店" },
      { date: "2026-10-03", amount: 300, merchant: "古い日付の店" },
    ]);
    // 古い日付の店のほうを、後から登録したことにする
    await db().prepare("UPDATE transactions SET created_at = ? WHERE merchant = ?").bind("2026-10-12T01:00:00.000Z", "新しい日付の店").run();
    await db().prepare("UPDATE transactions SET created_at = ? WHERE merchant = ?").bind("2026-10-12T02:00:00.000Z", "古い日付の店").run();
    const res = await getHome(db(), { now: NOW });
    if (!res.ok) throw new Error("home");
    expect(res.recent.map((r) => r.merchant)).toEqual(["古い日付の店", "新しい日付の店"]);
  });

  it("データがなくても 0 で返す", async () => {
    const res = await getHome(db(), { now: NOW });
    expect(res).toMatchObject({ ok: true, today: { total: 0, count: 0 }, groups: [], memo: { percent: 0 }, needs_review: 0, recent: [] });
  });
});
