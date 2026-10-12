import { describe, expect, it } from "vitest";
import { addEvent, listEvents, updateEvent } from "../../src/core/events";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const add = (input: unknown) => addEvent(db(), input, { now: NOW });

async function addOk(input: unknown) {
  const res = await add(input);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.event;
}

describe("title の長さ(1日のメモも title に書く)", () => {
  it("1000文字まで登録・更新できる。1001文字はエラー", async () => {
    const ev = await addOk({ title: "あ".repeat(1000), start_date: "2026-10-03" });
    expect(ev.title).toHaveLength(1000);
    expect((await add({ title: "あ".repeat(1001), start_date: "2026-10-03" })).ok).toBe(false);
    const up = await updateEvent(db(), { id: ev.id, title: "い".repeat(1000) }, { now: NOW });
    expect(up.ok).toBe(true);
    expect((await updateEvent(db(), { id: ev.id, title: "い".repeat(1001) }, { now: NOW })).ok).toBe(false);
  });
});

describe("addEvent", () => {
  it("期間の出来事を登録して、文章つきで返す", async () => {
    const res = await add({ title: "出張", start_date: "2026-10-03", end_date: "2026-10-05" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message).toBe("出来事を登録しました: 出張 2026-10-03〜2026-10-05(blue)");
    expect(res.event).toMatchObject({ title: "出張", start_date: "2026-10-03", end_date: "2026-10-05", note: null, color: "blue" });
    expect(res.event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("単日は end_date が null、色とメモを指定できる", async () => {
    const res = await add({ title: "誕生日", start_date: "2026-10-20", note: "ケーキ", color: "red" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event).toMatchObject({ end_date: null, note: "ケーキ", color: "red" });
    expect(res.message).toBe("出来事を登録しました: 誕生日 2026-10-20(red)");
    const row = await db().prepare("SELECT created_at, updated_at FROM events WHERE id = ?").bind(res.event.id).first();
    expect(row).toEqual({ created_at: NOW.toISOString(), updated_at: NOW.toISOString() });
  });

  it("不正な日付・end < start・未知の色・未知の項目は、項目名つきでエラー", async () => {
    const bad = await add({ title: "A", start_date: "2026-02-30" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatchObject({ field: "start_date" });

    const order = await add({ title: "A", start_date: "2026-10-05", end_date: "2026-10-03" });
    expect(order.ok).toBe(false);
    if (!order.ok) expect(order.errors).toEqual([{ field: "end_date", message: expect.stringContaining("start_date 以降") }]);

    const color = await add({ title: "A", start_date: "2026-10-05", color: "pink" });
    expect(color.ok).toBe(false);
    if (!color.ok) expect(color.errors[0]).toMatchObject({ field: "color" });

    const typo = await add({ title: "A", start_date: "2026-10-05", memo: "x" });
    expect(typo.ok).toBe(false);
    if (!typo.ok) expect(typo.errors[0]).toMatchObject({ field: "memo" });

    const empty = await add({ title: " ", start_date: "2026-10-05" });
    expect(empty.ok).toBe(false);

    const list = await listEvents(db(), {});
    expect(list.ok && list.events).toEqual([]);
  });
});

describe("updateEvent", () => {
  it("部分更新では、指定しなかった項目(色を含む)が保たれる", async () => {
    const ev = await addOk({ title: "出張", start_date: "2026-10-03", end_date: "2026-10-05", note: "東京", color: "purple" });
    const res = await updateEvent(db(), { id: ev.id, title: "出張(大阪)" }, { now: new Date("2026-10-12T00:00:00Z") });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event).toEqual({ id: ev.id, title: "出張(大阪)", start_date: "2026-10-03", end_date: "2026-10-05", note: "東京", color: "purple" });
    const row = await db().prepare("SELECT updated_at, created_at FROM events WHERE id = ?").bind(ev.id).first();
    expect(row).toEqual({ updated_at: "2026-10-12T00:00:00.000Z", created_at: NOW.toISOString() });
  });

  it("end_date: null で期間を解除、note: null で消去", async () => {
    const ev = await addOk({ title: "出張", start_date: "2026-10-03", end_date: "2026-10-05", note: "東京" });
    const res = await updateEvent(db(), { id: ev.id, end_date: null, note: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.event).toMatchObject({ end_date: null, note: null });
    const list = await listEvents(db(), {});
    expect(list.ok && list.events[0]).toMatchObject({ end_date: null, note: null });
  });

  it("既存値と合わせて整合を検証する", async () => {
    const ev = await addOk({ title: "出張", start_date: "2026-10-03", end_date: "2026-10-05" });
    const late = await updateEvent(db(), { id: ev.id, start_date: "2026-10-10" });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errors[0]).toMatchObject({ field: "end_date" });
    const early = await updateEvent(db(), { id: ev.id, end_date: "2026-10-01" });
    expect(early.ok).toBe(false);
    // 開始日を後ろにずらしても、期間を解除するなら通る
    const ok = await updateEvent(db(), { id: ev.id, start_date: "2026-10-10", end_date: null });
    expect(ok.ok).toBe(true);
    // 失敗した更新は反映されない
    const list = await listEvents(db(), {});
    expect(list.ok && list.events[0]).toMatchObject({ start_date: "2026-10-10", end_date: null });
  });

  it("存在しない id は、分かる文章でエラー", async () => {
    const res = await updateEvent(db(), { id: "no-such-id", title: "A" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toEqual([{ field: "id", message: expect.stringContaining("という出来事はありません") }]);
  });

  it("未知の色・空の更新・id なしはエラー", async () => {
    const ev = await addOk({ title: "A", start_date: "2026-10-03" });
    const color = await updateEvent(db(), { id: ev.id, color: "pink" });
    expect(color.ok).toBe(false);
    const nothing = await updateEvent(db(), { id: ev.id });
    expect(nothing.ok).toBe(false);
    const noId = await updateEvent(db(), { title: "A" });
    expect(noId.ok).toBe(false);
    if (!noId.ok) expect(noId.errors[0]).toMatchObject({ field: "id" });
  });
});

describe("listEvents", () => {
  async function seed() {
    await addOk({ title: "後半", start_date: "2026-10-20" });
    await addOk({ title: "期間", start_date: "2026-10-03", end_date: "2026-10-10" });
    await addOk({ title: "前", start_date: "2026-09-28", end_date: "2026-10-02" });
    await addOk({ title: "単日", start_date: "2026-10-10" });
  }
  const titles = async (input: unknown) => {
    const res = await listEvents(db(), input);
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    return res.events.map((e) => e.title);
  };

  it("開始日の昇順で返す", async () => {
    await seed();
    expect(await titles({})).toEqual(["前", "期間", "単日", "後半"]);
  });

  it("from / to と重なる出来事を返す(両端を含み、期間の途中も拾う)", async () => {
    await seed();
    expect(await titles({ from: "2026-10-05", to: "2026-10-09" })).toEqual(["期間"]);
    expect(await titles({ from: "2026-10-10", to: "2026-10-10" })).toEqual(["期間", "単日"]);
    expect(await titles({ from: "2026-10-11" })).toEqual(["後半"]);
    expect(await titles({ to: "2026-10-02" })).toEqual(["前"]);
    expect(await titles({ from: "2026-11-01" })).toEqual([]);
  });

  it("limit で件数を絞る。from > to や範囲外の limit はエラー", async () => {
    await seed();
    expect(await titles({ limit: 2 })).toEqual(["前", "期間"]);
    const res = await listEvents(db(), { from: "2026-10-10", to: "2026-10-01" });
    expect(res.ok).toBe(false);
    expect((await listEvents(db(), { limit: 501 })).ok).toBe(false);
  });

  it("各要素に id, start_date, end_date, title, note, color がある", async () => {
    await addOk({ title: "A", start_date: "2026-10-03", color: "green" });
    const res = await listEvents(db(), undefined);
    expect(res.ok && res.events[0]).toEqual({ id: expect.any(String), start_date: "2026-10-03", end_date: null, title: "A", note: null, color: "green" });
  });
});
