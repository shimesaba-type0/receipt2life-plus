import { describe, expect, it } from "vitest";
import { addSeatRecord, deleteSeatRecord, listSeatRecords, listSeatRecordsOnDay, updateSeatRecord } from "../../src/core/seat-records";
import { addTransactions, deleteTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const base = { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 4, note: "見やすい" };

// 登録順を確かめられるよう、1件ごとに created_at を1秒進める
let tick = 0;
async function add(over: Record<string, unknown> = {}) {
  const res = await addSeatRecord(db(), { ...base, ...over }, { now: new Date(NOW.getTime() + tick++ * 1000) });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.seat_record;
}

describe("addSeatRecord", () => {
  it("登録して、全項目を返す", async () => {
    const r = await add();
    expect(r).toEqual({ id: expect.any(String), ...base, title: null, transaction_id: null, created_at: expect.any(String) });
    expect(await db().prepare("SELECT venue, screen, seat, rating, note FROM seat_records WHERE id = ?").bind(r.id).first()).toEqual({
      venue: "A映画館",
      screen: "スクリーン5",
      seat: "F-5",
      rating: 4,
      note: "見やすい",
    });
  });

  it("必須は date・venue・seat だけ。任意項目は null で保存し、前後の空白は除く", async () => {
    const res = await addSeatRecord(db(), { date: "2026-10-10", venue: "  B劇場 ", seat: " 1列3番" }, { now: NOW });
    expect(res).toMatchObject({ ok: true, seat_record: { venue: "B劇場", seat: "1列3番", screen: null, rating: null, note: null, transaction_id: null } });
  });

  it("title(作品名・公演名)は任意。前後の空白を除き、空文字は未指定(NULL)扱い", async () => {
    const r = await add({ title: "  ダミー作品名 " });
    expect(r.title).toBe("ダミー作品名");
    expect(await db().prepare("SELECT title FROM seat_records WHERE id = ?").bind(r.id).first()).toEqual({ title: "ダミー作品名" });
    expect((await add({ title: "" })).title).toBeNull();
    expect((await add({ title: "   " })).title).toBeNull();
    expect((await add()).title).toBeNull();
    expect((await add({ title: "あ".repeat(100) })).title).toHaveLength(100);
    const tooLong = await addSeatRecord(db(), { ...base, title: "あ".repeat(101) });
    expect(tooLong).toMatchObject({ ok: false, errors: [{ field: "title" }] });
    expect((await addSeatRecord(db(), { ...base, title: 1 })).ok).toBe(false);
  });

  it("取引に紐づけられる。存在しない取引はエラー", async () => {
    const tx = await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 1900, merchant: "A映画館", category: "娯楽" }] }, { now: NOW });
    if (!tx.ok) throw new Error("tx");
    const r = await add({ transaction_id: tx.registered[0]!.id });
    expect(r.transaction_id).toBe(tx.registered[0]!.id);
    const bad = await addSeatRecord(db(), { ...base, transaction_id: "none" });
    expect(bad).toMatchObject({ ok: false, errors: [{ field: "transaction_id" }] });
  });

  it.each([
    [{ rating: 0 }, "rating"],
    [{ rating: 6 }, "rating"],
    [{ rating: 3.5 }, "rating"],
    [{ rating: "4" }, "rating"],
    [{ date: "2026-13-01" }, "date"],
    [{ date: "10/10" }, "date"],
    [{ venue: "" }, "venue"],
    [{ venue: "   " }, "venue"],
    [{ venue: "あ".repeat(101) }, "venue"],
    [{ screen: "あ".repeat(101) }, "screen"],
    [{ screen: "" }, "screen"],
    [{ seat: "" }, "seat"],
    [{ seat: "あ".repeat(51) }, "seat"],
    [{ note: "あ".repeat(201) }, "note"],
    [{ unknown_field: 1 }, "unknown_field"],
  ])("不正な入力 %j は %s のエラー", async (over, field) => {
    const res = await addSeatRecord(db(), { ...base, ...over });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.field)).toContain(field);
  });

  it("必須が欠けるとエラー", async () => {
    for (const key of ["date", "venue", "seat"]) {
      const { [key]: _omit, ...rest } = base as Record<string, unknown>;
      void _omit;
      const res = await addSeatRecord(db(), rest);
      expect(res.ok).toBe(false);
    }
  });

  it("上限ちょうどは通る", async () => {
    const res = await addSeatRecord(db(), { ...base, venue: "あ".repeat(100), screen: "い".repeat(100), seat: "う".repeat(50), note: "え".repeat(200), rating: 1 });
    expect(res.ok).toBe(true);
  });
});

describe("listSeatRecords", () => {
  async function seed() {
    await add({ date: "2026-10-01", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 5, note: "最高" });
    await add({ date: "2026-10-05", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 3 });
    await add({ date: "2026-10-05", venue: "A映画館", screen: "スクリーン1", seat: "A-1", rating: 1, note: "前すぎ" });
    await add({ date: "2026-10-10", venue: "B劇場", screen: undefined, seat: "1列3番", rating: undefined, note: undefined });
  }

  it("日付の新しい順(同じ日は登録の新しい順)で返し、件数と summary を付ける", async () => {
    await seed();
    const res = await listSeatRecords(db(), {});
    if (!res.ok) throw new Error("list");
    expect(res.count).toBe(4);
    expect(res.truncated).toBe(false);
    expect(res.records.map((r) => `${r.date} ${r.seat}`)).toEqual(["2026-10-10 1列3番", "2026-10-05 A-1", "2026-10-05 F-5", "2026-10-01 F-5"]);
    expect(res.summary).toEqual([
      { venue: "A映画館", screen: "スクリーン1", seat: "A-1", count: 1, rated_count: 1, avg_rating: 1 },
      { venue: "A映画館", screen: "スクリーン5", seat: "F-5", count: 2, rated_count: 2, avg_rating: 4 },
      { venue: "B劇場", screen: null, seat: "1列3番", count: 1, rated_count: 0, avg_rating: null },
    ]);
  });

  it("平均は小数1桁", async () => {
    await add({ rating: 5 });
    await add({ rating: 4 });
    await add({ rating: 4 });
    const res = await listSeatRecords(db(), {});
    expect(res).toMatchObject({ ok: true, summary: [{ count: 3, rated_count: 3, avg_rating: 4.3 }] });
  });

  it("venue / screen / seat で絞る(完全一致)", async () => {
    await seed();
    expect(await listSeatRecords(db(), { venue: "A映画館" })).toMatchObject({ count: 3 });
    expect(await listSeatRecords(db(), { venue: "A映画館", screen: "スクリーン5" })).toMatchObject({ count: 2 });
    expect(await listSeatRecords(db(), { venue: "A映画館", screen: "スクリーン5", seat: "F-5" })).toMatchObject({ count: 2 });
    expect(await listSeatRecords(db(), { seat: "F-5" })).toMatchObject({ count: 2 });
    expect(await listSeatRecords(db(), { venue: "A映画" })).toMatchObject({ count: 0, records: [], summary: [] });
  });

  it("title で絞る(部分一致。LIKE のワイルドカードは文字として扱う)。summary の形は変わらない", async () => {
    await add({ title: "ダミー作品A", seat: "F-5" });
    await add({ title: "ライブ100%_テスト", seat: "G-1" });
    await add({ title: "別の催し", seat: "H-2" });
    await add({ seat: "J-3" });
    expect(await listSeatRecords(db(), { title: "作品" })).toMatchObject({ count: 1, records: [{ title: "ダミー作品A" }] });
    expect(await listSeatRecords(db(), { title: "ライブ" })).toMatchObject({ count: 1 });
    expect(await listSeatRecords(db(), { title: "%" })).toMatchObject({ count: 1, records: [{ seat: "G-1" }] });
    expect(await listSeatRecords(db(), { title: "_" })).toMatchObject({ count: 1, records: [{ seat: "G-1" }] });
    expect(await listSeatRecords(db(), { title: "ダ%A" })).toMatchObject({ count: 0 });
    expect(await listSeatRecords(db(), { title: "なし" })).toMatchObject({ count: 0, records: [], summary: [] });
    const res = await listSeatRecords(db(), { title: "作品" });
    if (!res.ok) throw new Error("list");
    expect(Object.keys(res.summary[0]!).sort()).toEqual(["avg_rating", "count", "rated_count", "screen", "seat", "venue"]);
    expect(res.records[0]).toHaveProperty("title", "ダミー作品A");
    expect((await listSeatRecords(db(), { title: "あ".repeat(101) })).ok).toBe(false);
    expect((await listSeatRecords(db(), { title: "" })).ok).toBe(false);
  });

  it("min_rating / max_rating で絞る(評価なしは除く)", async () => {
    await seed();
    const high = await listSeatRecords(db(), { min_rating: 4 });
    expect(high).toMatchObject({ count: 1, records: [{ rating: 5 }] });
    const low = await listSeatRecords(db(), { max_rating: 3 });
    expect(low).toMatchObject({ count: 2 });
    expect(await listSeatRecords(db(), { min_rating: 3, max_rating: 3 })).toMatchObject({ count: 1 });
  });

  it("from / to(両端を含む)と transaction_id で絞る", async () => {
    await seed();
    expect(await listSeatRecords(db(), { from: "2026-10-05" })).toMatchObject({ count: 3 });
    expect(await listSeatRecords(db(), { to: "2026-10-04" })).toMatchObject({ count: 1 });
    expect(await listSeatRecords(db(), { from: "2026-10-05", to: "2026-10-05" })).toMatchObject({ count: 2 });
    const tx = await addTransactions(db(), { transactions: [{ date: "2026-10-09", amount: 1900, merchant: "A映画館", category: "娯楽" }] }, { now: NOW });
    if (!tx.ok) throw new Error("tx");
    const id = tx.registered[0]!.id;
    const linked = await add({ date: "2026-10-12", transaction_id: id });
    const res = await listSeatRecords(db(), { transaction_id: id });
    expect(res).toMatchObject({ count: 1, records: [{ id: linked.id }] });
  });

  it("limit は records だけを減らし、count と summary は全件で数える", async () => {
    await seed();
    const res = await listSeatRecords(db(), { limit: 2 });
    if (!res.ok) throw new Error("list");
    expect(res.records).toHaveLength(2);
    expect(res.count).toBe(4);
    expect(res.truncated).toBe(true);
    expect(res.summary.reduce((s, r) => s + r.count, 0)).toBe(4);
  });

  it("不正な指定はエラー", async () => {
    for (const input of [{ min_rating: 0 }, { max_rating: 6 }, { limit: 0 }, { limit: 501 }, { from: "x" }, { from: "2026-10-10", to: "2026-10-01" }, { min_rating: 4, max_rating: 2 }, { bogus: 1 }]) {
      expect((await listSeatRecords(db(), input)).ok).toBe(false);
    }
  });

  it("空なら該当なしのメッセージ。引数なしでも呼べる", async () => {
    expect(await listSeatRecords(db(), undefined)).toMatchObject({ ok: true, count: 0, records: [], summary: [], message: "該当する座席の記録はありません" });
  });

  it("listSeatRecordsOnDay はその日の分だけを登録順で返す", async () => {
    await seed();
    const day = await listSeatRecordsOnDay(db(), "2026-10-05");
    expect(day.map((r) => r.seat)).toEqual(["F-5", "A-1"]);
    expect(await listSeatRecordsOnDay(db(), "2026-10-06")).toEqual([]);
  });
});

describe("updateSeatRecord", () => {
  it("指定した項目だけ変え、null で任意項目を消せる", async () => {
    const r = await add();
    const res = await updateSeatRecord(db(), { id: r.id, seat: "G-7", rating: 2 });
    expect(res).toMatchObject({ ok: true, seat_record: { id: r.id, seat: "G-7", rating: 2, venue: "A映画館", screen: "スクリーン5", note: "見やすい" } });
    const cleared = await updateSeatRecord(db(), { id: r.id, screen: null, rating: null, note: null });
    expect(cleared).toMatchObject({ ok: true, seat_record: { screen: null, rating: null, note: null, seat: "G-7" } });
    expect(await db().prepare("SELECT screen, rating, note, created_at FROM seat_records WHERE id = ?").bind(r.id).first()).toEqual({ screen: null, rating: null, note: null, created_at: r.created_at });
  });

  it("title を直せる。null や空文字で消せ、省略すると変えない", async () => {
    const r = await add({ title: "ダミー作品A" });
    expect(await updateSeatRecord(db(), { id: r.id, title: "  ダミー作品B " })).toMatchObject({ ok: true, seat_record: { title: "ダミー作品B" } });
    expect(await updateSeatRecord(db(), { id: r.id, seat: "G-7" })).toMatchObject({ ok: true, seat_record: { title: "ダミー作品B", seat: "G-7" } });
    expect(await updateSeatRecord(db(), { id: r.id, title: null })).toMatchObject({ ok: true, seat_record: { title: null } });
    expect(await db().prepare("SELECT title FROM seat_records WHERE id = ?").bind(r.id).first()).toEqual({ title: null });
    await updateSeatRecord(db(), { id: r.id, title: "ダミー作品C" });
    expect(await updateSeatRecord(db(), { id: r.id, title: "" })).toMatchObject({ ok: true, seat_record: { title: null } });
    expect(await updateSeatRecord(db(), { id: r.id, title: "  " })).toMatchObject({ ok: true, seat_record: { title: null } });
    expect((await updateSeatRecord(db(), { id: r.id, title: "あ".repeat(101) })).ok).toBe(false);
  });

  it("取引の紐づけを付けたり外したりできる", async () => {
    const tx = await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 1900, merchant: "A映画館", category: "娯楽" }] }, { now: NOW });
    if (!tx.ok) throw new Error("tx");
    const r = await add();
    const id = tx.registered[0]!.id;
    expect(await updateSeatRecord(db(), { id: r.id, transaction_id: id })).toMatchObject({ ok: true, seat_record: { transaction_id: id } });
    expect(await updateSeatRecord(db(), { id: r.id, transaction_id: null })).toMatchObject({ ok: true, seat_record: { transaction_id: null } });
    expect(await updateSeatRecord(db(), { id: r.id, transaction_id: "none" })).toMatchObject({ ok: false, errors: [{ field: "transaction_id" }] });
  });

  it("存在しない id・更新項目なし・範囲外の評価・必須の項目を null はエラー", async () => {
    const r = await add();
    expect(await updateSeatRecord(db(), { id: "none", seat: "A-1" })).toMatchObject({ ok: false, errors: [{ field: "id", message: expect.stringContaining("という座席の記録はありません") }] });
    expect(await updateSeatRecord(db(), { id: r.id })).toMatchObject({ ok: false, errors: [{ field: "input" }] });
    expect((await updateSeatRecord(db(), { id: r.id, rating: 6 })).ok).toBe(false);
    expect((await updateSeatRecord(db(), { id: r.id, venue: null })).ok).toBe(false);
    expect((await updateSeatRecord(db(), { id: r.id, seat: "" })).ok).toBe(false);
    expect((await updateSeatRecord(db(), { id: r.id, date: "2026-02-30" })).ok).toBe(false);
  });
});

describe("deleteSeatRecord と取引の削除", () => {
  it("削除すると、削除した内容を返す。もう一度はエラー", async () => {
    const r = await add();
    expect(await deleteSeatRecord(db(), { id: r.id })).toMatchObject({ ok: true, deleted: { id: r.id, seat: "F-5" } });
    expect(await listSeatRecords(db(), {})).toMatchObject({ count: 0 });
    expect(await deleteSeatRecord(db(), { id: r.id })).toMatchObject({ ok: false, errors: [{ field: "id" }] });
  });

  it("取引を削除しても座席の記録は残り、transaction_id だけ NULL になる", async () => {
    const tx = await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 1900, merchant: "A映画館", category: "娯楽" }] }, { now: NOW });
    if (!tx.ok) throw new Error("tx");
    const id = tx.registered[0]!.id;
    const r = await add({ transaction_id: id });
    expect(await deleteTransaction(db(), { id })).toMatchObject({ ok: true });
    const row = await db().prepare("SELECT id, seat, transaction_id FROM seat_records WHERE id = ?").bind(r.id).first();
    expect(row).toEqual({ id: r.id, seat: "F-5", transaction_id: null });
  });

  it("DB の制約: 評価は1〜5だけ", async () => {
    await expect(
      db().prepare("INSERT INTO seat_records (id, date, venue, seat, rating, created_at) VALUES ('x', '2026-10-10', 'A', 'F-5', 6, 't')").run(),
    ).rejects.toThrow();
  });
});
