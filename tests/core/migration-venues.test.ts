import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDay } from "../../src/core/calendar";
import { listSeatRecords } from "../../src/core/seat-records";
import { listVenues } from "../../src/core/venues";
import { testEnv } from "../helpers";

// 0010(会場とスクリーンを別のレコードに分ける)は、seat_records のテーブルを作り直す。
// 旧い形(venue / screen が文字列)のデータを入れてから 0010 を当てて、データが失われないことを確かめる
const MIGRATION = "0010_venues_screens.sql";
// 0010 はテーブルを作り直すので、後ろの 0011(seat_class の追加)も当て直す必要がある
const LATER_MIGRATION = "0011_seat_record_class.sql";

async function rollBackTo0009() {
  const e = testEnv();
  await e.DB.exec("DROP TABLE seat_records");
  await e.DB.exec("DROP TABLE screens");
  await e.DB.exec("DROP TABLE venues");
  // 0008 + 0009 と同じ旧い形
  await e.DB.exec(
    "CREATE TABLE seat_records (id TEXT PRIMARY KEY, date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), venue TEXT NOT NULL, screen TEXT, seat TEXT NOT NULL, rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)), note TEXT, transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL, created_at TEXT NOT NULL, title TEXT)",
  );
  await e.DB.exec("CREATE INDEX idx_seat_records_venue_date ON seat_records(venue, date)");
  await e.DB.exec("CREATE INDEX idx_seat_records_date ON seat_records(date)");
  await e.DB.exec("CREATE INDEX idx_seat_records_transaction_id ON seat_records(transaction_id)");
  await e.DB.prepare("DELETE FROM d1_migrations WHERE name IN (?, ?)").bind(MIGRATION, LATER_MIGRATION).run();
}

const insertOld = (id: string, date: string, venue: string, screen: string | null, over: { rating?: number | null; note?: string | null; title?: string | null; tx?: string | null } = {}) =>
  testEnv()
    .DB.prepare("INSERT INTO seat_records (id, date, venue, screen, seat, rating, note, transaction_id, created_at, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, date, venue, screen, `S-${id}`, over.rating ?? null, over.note ?? null, over.tx ?? null, `${date}T03:00:00.000Z`, over.title ?? null)
    .run();

describe("migration 0010_venues_screens", () => {
  it("旧い形のデータを失わずに移す(会場は重複を1件に、(会場, スクリーン)の組は screens に、空の screen は screen_id NULL)", async () => {
    const e = testEnv();
    await rollBackTo0009();
    await e.DB.prepare(
      "INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag) VALUES ('tx1', '2026-10-01', 1900, 'A映画館', 'cat_leisure', NULL, NULL, 'manual', 'ok', 'h', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', NULL)",
    ).run();
    await insertOld("r1", "2026-10-01", "A映画館", "スクリーン5", { rating: 4, note: "見やすい", title: "ダミー作品A", tx: "tx1" });
    await insertOld("r2", "2026-10-02", "A映画館", "スクリーン5", { rating: 2 });
    await insertOld("r3", "2026-10-03", "A映画館", "スクリーン6");
    await insertOld("r4", "2026-10-03", "A映画館", null, { rating: 5 });
    await insertOld("r5", "2026-10-04", "A映画館", "  ");
    await insertOld("r6", "2026-10-05", "B劇場", "スクリーン5", { rating: 3 });
    await insertOld("r7", "2026-10-06", "B劇場", null);
    const before = (await e.DB.prepare("SELECT id, date, title, seat, rating, note, transaction_id, created_at FROM seat_records ORDER BY id").all()).results;

    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

    // 行は1件も減らず、会場・スクリーン以外の列は変わらない
    expect((await e.DB.prepare("SELECT id, date, title, seat, rating, note, transaction_id, created_at FROM seat_records ORDER BY id").all()).results).toEqual(before);
    expect((await e.DB.prepare("SELECT name FROM venues ORDER BY name").all()).results).toEqual([{ name: "A映画館" }, { name: "B劇場" }]);
    expect(
      (await e.DB.prepare("SELECT v.name AS venue, s.name AS screen, s.note FROM screens s JOIN venues v ON v.id = s.venue_id ORDER BY v.name, s.name").all()).results,
    ).toEqual([
      { venue: "A映画館", screen: "スクリーン5", note: null },
      { venue: "A映画館", screen: "スクリーン6", note: null },
      { venue: "B劇場", screen: "スクリーン5", note: null },
    ]);

    // 名前で引くと、旧い文字列と同じ
    const rows = (
      await e.DB.prepare(
        "SELECT r.id, v.name AS venue, s.name AS screen FROM seat_records r JOIN venues v ON v.id = r.venue_id LEFT JOIN screens s ON s.id = r.screen_id ORDER BY r.id",
      ).all()
    ).results;
    expect(rows).toEqual([
      { id: "r1", venue: "A映画館", screen: "スクリーン5" },
      { id: "r2", venue: "A映画館", screen: "スクリーン5" },
      { id: "r3", venue: "A映画館", screen: "スクリーン6" },
      { id: "r4", venue: "A映画館", screen: null },
      { id: "r5", venue: "A映画館", screen: null },
      { id: "r6", venue: "B劇場", screen: "スクリーン5" },
      { id: "r7", venue: "B劇場", screen: null },
    ]);

    // core・日の詳細も従来どおり動く
    const list = await listSeatRecords(e.DB, { venue: "A映画館", screen: "スクリーン5" });
    expect(list).toMatchObject({ ok: true, count: 2, summary: [{ venue: "A映画館", screen: "スクリーン5", count: 1 }, { count: 1 }] });
    const day = await getDay(e.DB, "2026-10-01");
    expect(day.ok && day.seat_records[0]).toMatchObject({ id: "r1", venue: "A映画館", screen: "スクリーン5", title: "ダミー作品A", transaction_id: "tx1", rating: 4 });
    const venues = await listVenues(e.DB);
    expect(venues.venues.map((v) => [v.name, v.record_count])).toEqual([["A映画館", 5], ["B劇場", 2]]);
  });

  it("制約を引き継ぐ: 評価の CHECK、日付の CHECK、会場の外部キー、取引が消えたら transaction_id だけ NULL、index", async () => {
    const e = testEnv();
    await rollBackTo0009();
    await e.DB.prepare(
      "INSERT INTO transactions (id, date, amount, merchant, category_id, account_id, memo, source, status, dedup_hash, created_at, updated_at, tax_flag) VALUES ('tx1', '2026-10-01', 1900, 'A映画館', 'cat_leisure', NULL, NULL, 'manual', 'ok', 'h', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', NULL)",
    ).run();
    await insertOld("r1", "2026-10-01", "A映画館", "スクリーン5", { tx: "tx1" });
    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);

    const venue = await e.DB.prepare("SELECT id FROM venues").first<{ id: string }>();
    const ins = (id: string, date: string, venueId: string, rating: number | null) =>
      e.DB.prepare("INSERT INTO seat_records (id, date, venue_id, seat, rating, created_at) VALUES (?, ?, ?, 'F-5', ?, 'now')").bind(id, date, venueId, rating).run();
    await expect(ins("x1", "2026-10-01", venue!.id, 6)).rejects.toThrow();
    await expect(ins("x2", "2026/10/01", venue!.id, 3)).rejects.toThrow();
    await expect(ins("x3", "2026-10-01", "none", 3)).rejects.toThrow();
    await expect(ins("x4", "2026-10-01", venue!.id, 3)).resolves.toBeDefined();
    // 会場は必須(NULL 不可)
    await expect(e.DB.prepare("INSERT INTO seat_records (id, date, venue_id, seat, created_at) VALUES ('x5', '2026-10-01', NULL, 'F-5', 'now')").run()).rejects.toThrow();

    await e.DB.exec("DELETE FROM transactions WHERE id = 'tx1'");
    expect(await e.DB.prepare("SELECT id, transaction_id FROM seat_records WHERE id = 'r1'").first()).toEqual({ id: "r1", transaction_id: null });

    const indexes = (await e.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'seat_records' AND name LIKE 'idx_%' ORDER BY name").all()).results.map((r) => r.name);
    expect(indexes).toEqual(["idx_seat_records_date", "idx_seat_records_screen_id", "idx_seat_records_transaction_id", "idx_seat_records_venue_date"]);
  });

  it("データがない DB でも当たる。会場名の UNIQUE と(会場, スクリーン名)の UNIQUE が効く", async () => {
    const e = testEnv();
    await rollBackTo0009();
    await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
    await e.DB.exec("INSERT INTO venues (id, name, created_at) VALUES ('v1', 'A映画館', 'now')");
    await expect(e.DB.exec("INSERT INTO venues (id, name, created_at) VALUES ('v2', 'A映画館', 'now')")).rejects.toThrow();
    await e.DB.exec("INSERT INTO screens (id, venue_id, name, note, created_at) VALUES ('s1', 'v1', 'スクリーン5', NULL, 'now')");
    await expect(e.DB.exec("INSERT INTO screens (id, venue_id, name, note, created_at) VALUES ('s2', 'v1', 'スクリーン5', NULL, 'now')")).rejects.toThrow();
  });
});
