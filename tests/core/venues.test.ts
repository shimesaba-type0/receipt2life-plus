import { describe, expect, it } from "vitest";
import { addSeatRecord, deleteSeatRecord, listSeatRecords, updateSeatRecord } from "../../src/core/seat-records";
import { findOrCreateScreen, findOrCreateVenue, listVenues, updateScreen, updateVenue } from "../../src/core/venues";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const base = { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 4 };
const count = async (table: string) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

async function add(over: Record<string, unknown> = {}) {
  const res = await addSeatRecord(db(), { ...base, ...over }, { now: NOW });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res;
}

describe("find-or-create", () => {
  it("会場は完全一致(前後の空白は除く)で探し、無ければ作る", async () => {
    const a = await findOrCreateVenue(db(), "  A映画館 ", { now: NOW });
    expect(a).toMatchObject({ name: "A映画館", created: true });
    const again = await findOrCreateVenue(db(), "A映画館");
    expect(again).toEqual({ id: a.id, name: "A映画館", created: false });
    // 完全一致なので、似た名前は別の会場
    expect((await findOrCreateVenue(db(), "A映画館 ")).created).toBe(false);
    expect((await findOrCreateVenue(db(), "Ａ映画館")).created).toBe(true);
    expect(await count("venues")).toBe(2);
  });

  it("スクリーンは(会場, 名前)で探す。同じ名前でも会場が違えば別", async () => {
    const a = await findOrCreateVenue(db(), "A映画館");
    const b = await findOrCreateVenue(db(), "B劇場");
    const s1 = await findOrCreateScreen(db(), a.id, "スクリーン5");
    expect(s1.created).toBe(true);
    expect(await findOrCreateScreen(db(), a.id, " スクリーン5 ")).toEqual({ id: s1.id, name: "スクリーン5", created: false });
    expect((await findOrCreateScreen(db(), b.id, "スクリーン5")).created).toBe(true);
    expect(await count("screens")).toBe(2);
  });
});

describe("座席の記録の登録で会場・スクリーンを自動作成する", () => {
  it("初回は新規に作り(created_venue / created_screen が true、message に書く)、2回目からは同じものを使う", async () => {
    const first = await add();
    expect(first).toMatchObject({ created_venue: true, created_screen: true });
    expect(first.message).toContain("会場「A映画館」を新規に作りました");
    expect(first.message).toContain("スクリーン「スクリーン5」を新規に作りました");
    const second = await add({ seat: "G-1" });
    expect(second).toMatchObject({ created_venue: false, created_screen: false });
    expect(second.message).not.toContain("新規に作りました");
    expect(second.seat_record.venue_id).toBe(first.seat_record.venue_id);
    expect(second.seat_record.screen_id).toBe(first.seat_record.screen_id);
    expect(await count("venues")).toBe(1);
    expect(await count("screens")).toBe(1);
  });

  it("会場は既存でスクリーンだけ新しいとき、スクリーンだけ created。スクリーン省略なら screen_id は null", async () => {
    await add();
    expect(await add({ screen: "スクリーン6" })).toMatchObject({ created_venue: false, created_screen: true });
    const none = await add({ screen: undefined });
    expect(none).toMatchObject({ created_venue: false, created_screen: false, seat_record: { screen: null, screen_id: null, screen_note: null } });
  });

  it("表記ゆれは別の会場として作られ、created_venue で気づける", async () => {
    await add();
    const r = await add({ venue: "A映画館 梅田" });
    expect(r.created_venue).toBe(true);
    expect(r.message).toContain("list_venues");
    expect(await count("venues")).toBe(2);
  });

  it("入力が不正なら、会場・スクリーンは作られない", async () => {
    expect((await addSeatRecord(db(), { ...base, rating: 9 })).ok).toBe(false);
    expect((await addSeatRecord(db(), { ...base, transaction_id: "none" })).ok).toBe(false);
    expect(await count("venues")).toBe(0);
    expect(await count("screens")).toBe(0);
  });
});

describe("座席の記録の更新・削除と会場・スクリーン", () => {
  it("venue を直すと、新しい会場を探す(無ければ作る)。同じスクリーン名は新しい会場の下に移る。空になった古い会場は片づく", async () => {
    const r = await add();
    const res = await updateSeatRecord(db(), { id: r.seat_record.id, venue: "B劇場" }, { now: NOW });
    expect(res).toMatchObject({ ok: true, created_venue: true, created_screen: true, seat_record: { venue: "B劇場", screen: "スクリーン5" } });
    if (!res.ok) return;
    expect(res.seat_record.venue_id).not.toBe(r.seat_record.venue_id);
    expect(res.seat_record.screen_id).not.toBe(r.seat_record.screen_id);
    expect(await db().prepare("SELECT name FROM venues").all()).toMatchObject({ results: [{ name: "B劇場" }] });
    expect(await count("screens")).toBe(1);
  });

  it("screen を直す・消す。消したスクリーンに記録も note もなければ片づくが、note があれば残る", async () => {
    const r = await add();
    const noted = await findOrCreateScreen(db(), r.seat_record.venue_id, "スクリーン5");
    await updateScreen(db(), { id: noted.id, note: "前方は首が疲れる" });
    const moved = await updateSeatRecord(db(), { id: r.seat_record.id, screen: "スクリーン6" });
    expect(moved).toMatchObject({ ok: true, created_venue: false, created_screen: true, seat_record: { screen: "スクリーン6", screen_note: null } });
    // note つきの「スクリーン5」は記録がなくても残る
    expect(await count("screens")).toBe(2);
    const cleared = await updateSeatRecord(db(), { id: r.seat_record.id, screen: null });
    expect(cleared).toMatchObject({ ok: true, seat_record: { screen: null, screen_id: null } });
    expect(await db().prepare("SELECT name, note FROM screens").all()).toMatchObject({ results: [{ name: "スクリーン5", note: "前方は首が疲れる" }] });
  });

  it("venue / screen を変えない更新では、会場・スクリーンは作られず id も変わらない", async () => {
    const r = await add();
    const res = await updateSeatRecord(db(), { id: r.seat_record.id, seat: "G-7" });
    expect(res).toMatchObject({ ok: true, created_venue: false, created_screen: false, seat_record: { venue_id: r.seat_record.venue_id, screen_id: r.seat_record.screen_id } });
  });

  it("最後の記録を消すと、名前だけの会場・スクリーンは片づく。他の記録がある会場は残る", async () => {
    const a = await add();
    const b = await add({ venue: "B劇場", screen: undefined });
    await deleteSeatRecord(db(), { id: a.seat_record.id });
    expect(await count("screens")).toBe(0);
    expect(await db().prepare("SELECT name FROM venues").all()).toMatchObject({ results: [{ name: "B劇場" }] });
    await deleteSeatRecord(db(), { id: b.seat_record.id });
    expect(await count("venues")).toBe(0);
  });

  it("絞り込みと summary は、名前のまま動く(内部は JOIN)", async () => {
    await add();
    await add({ seat: "G-1", rating: 2 });
    await add({ venue: "B劇場", screen: undefined, seat: "1列3番" });
    expect(await listSeatRecords(db(), { venue: "A映画館", screen: "スクリーン5" })).toMatchObject({ count: 2 });
    expect(await listSeatRecords(db(), { venue: "B劇場" })).toMatchObject({ count: 1, summary: [{ venue: "B劇場", screen: null, seat: "1列3番", count: 1 }] });
    const all = await listSeatRecords(db(), {});
    expect(all.ok && all.records.map((r) => r.venue).sort()).toEqual(["A映画館", "A映画館", "B劇場"]);
  });
});

describe("listVenues", () => {
  it("会場ごとにスクリーンと、記録件数・平均評価・note を返す", async () => {
    await add();
    await add({ seat: "G-1", rating: 2 });
    await add({ screen: "スクリーン6", rating: undefined });
    await add({ screen: undefined, seat: "A-1", rating: 5 });
    await add({ venue: "B劇場", screen: undefined, seat: "1列3番", rating: undefined });
    const screen5 = await db().prepare("SELECT id FROM screens WHERE name = 'スクリーン5'").first<{ id: string }>();
    await updateScreen(db(), { id: screen5!.id, note: "前方は首が疲れる" });

    const res = await listVenues(db());
    expect(res.count).toBe(2);
    expect(res.venues.map((v) => v.name)).toEqual(["A映画館", "B劇場"]);
    const a = res.venues[0]!;
    // 会場の件数はスクリーン未指定の記録も含む: 4件、評価ありは 4,2,5 の3件
    expect(a).toMatchObject({ record_count: 4, rated_count: 3, avg_rating: 3.7 });
    expect(a.screens.map((s) => s.name)).toEqual(["スクリーン5", "スクリーン6"]);
    expect(a.screens[0]).toMatchObject({ record_count: 2, rated_count: 2, avg_rating: 3, note: "前方は首が疲れる" });
    expect(a.screens[1]).toMatchObject({ record_count: 1, rated_count: 0, avg_rating: null, note: null });
    expect(res.venues[1]).toMatchObject({ name: "B劇場", record_count: 1, avg_rating: null, screens: [] });
  });

  it("空なら会場なし", async () => {
    expect(await listVenues(db())).toMatchObject({ ok: true, count: 0, venues: [], message: "登録済みの会場はありません" });
  });
});

describe("updateVenue / updateScreen", () => {
  it("会場名を変えると、その会場の記録も新しい名前になる", async () => {
    const r = await add();
    const res = await updateVenue(db(), { id: r.seat_record.venue_id, name: " A映画館(梅田) " });
    expect(res).toMatchObject({ ok: true, venue: { id: r.seat_record.venue_id, name: "A映画館(梅田)", record_count: 1 } });
    const list = await listSeatRecords(db(), { venue: "A映画館(梅田)" });
    expect(list).toMatchObject({ ok: true, count: 1 });
    expect(await listSeatRecords(db(), { venue: "A映画館" })).toMatchObject({ count: 0 });
  });

  it("会場名: 同じ名前の会場がある・存在しない id・空はエラー", async () => {
    const a = await add();
    await add({ venue: "B劇場", screen: undefined });
    expect(await updateVenue(db(), { id: a.seat_record.venue_id, name: "B劇場" })).toMatchObject({ ok: false, errors: [{ field: "name" }] });
    expect(await updateVenue(db(), { id: "none", name: "C" })).toMatchObject({ ok: false, errors: [{ field: "id", message: expect.stringContaining("という会場はありません") }] });
    expect((await updateVenue(db(), { id: a.seat_record.venue_id, name: "  " })).ok).toBe(false);
    expect((await updateVenue(db(), { id: a.seat_record.venue_id, name: "あ".repeat(101) })).ok).toBe(false);
    expect((await updateVenue(db(), { id: a.seat_record.venue_id })).ok).toBe(false);
  });

  it("スクリーン: 名前の変更、note の設定・消去(null / 空文字)、省略は変えない", async () => {
    const r = await add();
    const id = r.seat_record.screen_id!;
    expect(await updateScreen(db(), { id, note: " 前方は首が疲れる " })).toMatchObject({ ok: true, screen: { id, name: "スクリーン5", note: "前方は首が疲れる" } });
    const renamed = await updateScreen(db(), { id, name: "スクリーン5(IMAX)" });
    expect(renamed).toMatchObject({ ok: true, screen: { name: "スクリーン5(IMAX)", note: "前方は首が疲れる" } });
    // 記録には新しい名前と note が見える
    const list = await listSeatRecords(db(), { screen: "スクリーン5(IMAX)" });
    expect(list.ok && list.records[0]).toMatchObject({ screen: "スクリーン5(IMAX)", screen_note: "前方は首が疲れる" });
    expect(await updateScreen(db(), { id, note: null })).toMatchObject({ ok: true, screen: { note: null } });
    await updateScreen(db(), { id, note: "x" });
    expect(await updateScreen(db(), { id, note: "" })).toMatchObject({ ok: true, screen: { note: null } });
  });

  it("スクリーン: 同じ会場に同じ名前がある・存在しない id・指定なし・長すぎる note はエラー。別の会場なら同じ名前にできる", async () => {
    const a = await add();
    const six = await add({ screen: "スクリーン6" });
    const other = await add({ venue: "B劇場", screen: "ホール" });
    expect(await updateScreen(db(), { id: six.seat_record.screen_id, name: "スクリーン5" })).toMatchObject({ ok: false, errors: [{ field: "name" }] });
    expect(await updateScreen(db(), { id: other.seat_record.screen_id, name: "スクリーン5" })).toMatchObject({ ok: true });
    expect(await updateScreen(db(), { id: "none", name: "x" })).toMatchObject({ ok: false, errors: [{ field: "id", message: expect.stringContaining("というスクリーンはありません") }] });
    expect((await updateScreen(db(), { id: a.seat_record.screen_id })).ok).toBe(false);
    expect((await updateScreen(db(), { id: a.seat_record.screen_id, note: "あ".repeat(201) })).ok).toBe(false);
    expect((await updateScreen(db(), { id: a.seat_record.screen_id, bogus: 1 })).ok).toBe(false);
  });
});
