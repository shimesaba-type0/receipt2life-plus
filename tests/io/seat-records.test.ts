import { describe, expect, it } from "vitest";
import { addSeatRecord } from "../../src/core/seat-records";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");

async function exportRecords(): Promise<Record<string, unknown>[]> {
  const text = await new Response(exportJsonl(db())).text();
  return text === "" ? [] : text.trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function doImport(text: string): Promise<Extract<ImportResponse, { ok: true }>> {
  const res = await importRecords(db(), text, { now: NOW });
  if (!res.ok) throw new Error(`import failed: ${res.error}`);
  return res;
}

const count = async (table: string) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const tx = { type: "transaction", id: "tx1", date: "2026-10-10", amount: 1900, merchant: "A映画館", category: "娯楽" };
const seat = (over: Record<string, unknown> = {}) => ({ type: "seat_record", id: "st1", date: "2026-10-10", venue: "A映画館", seat: "F-5", ...over });

describe("座席の記録のエクスポート", () => {
  it("type=seat_record の行が最後に出る(直前に screen)。既存の type の順は変わらない", async () => {
    await doImport(jsonl(tx));
    await addSeatRecord(db(), { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 4, note: "見やすい", title: "ダミー作品A", transaction_id: "tx1" }, { now: NOW });
    const rows = await exportRecords();
    expect(rows.map((r) => r.type)).toEqual(["transaction", "screen", "seat_record"]);
    // 会場は id ではなく名前で持つ(往復・旧形式との互換)
    expect(rows[1]).toMatchObject({ type: "screen", venue: "A映画館", name: "スクリーン5", note: null, created_at: NOW.toISOString() });
    expect(rows[2]).toMatchObject({
      type: "seat_record",
      date: "2026-10-10",
      title: "ダミー作品A",
      venue: "A映画館",
      screen: "スクリーン5",
      seat: "F-5",
      rating: 4,
      note: "見やすい",
      transaction_id: "tx1",
      created_at: NOW.toISOString(),
    });
  });

  it("書き出して、空のDBに戻すと同じ内容になる(往復)", async () => {
    await doImport(jsonl(tx));
    await addSeatRecord(db(), { date: "2026-10-10", venue: "A映画館", seat: "F-5", transaction_id: "tx1" }, { now: NOW });
    await addSeatRecord(db(), { date: "2026-10-11", venue: "B劇場", screen: "ホール", seat: "1列3番", rating: 5, note: "最高", title: "ダミーライブ" }, { now: NOW });
    const before = await new Response(exportJsonl(db())).text();
    await db().exec("DELETE FROM seat_records");
    await db().exec("DELETE FROM screens");
    await db().exec("DELETE FROM venues");
    await db().exec("DELETE FROM transactions");
    const res = await doImport(before);
    expect(res.summary).toMatchObject({ errors: 0, ok: 4 });
    // note つきのスクリーンも往復で失われない(下の screen のテストで確かめる)
    expect(await new Response(exportJsonl(db())).text()).toBe(before);
  });
});

describe("座席の記録のインポート", () => {
  it("取り込む。順序がファイルの中で前後しても、取引の後に入る", async () => {
    const res = await doImport(jsonl(seat({ transaction_id: "tx1", screen: "スクリーン5", rating: 3, note: "ふつう", title: "  ダミー作品A " }), tx));
    expect(res.results[0]).toMatchObject({ line: 1, type: "seat_record", status: "ok", id: "st1" });
    expect(
      await db()
        .prepare(
          `SELECT r.title, v.name AS venue, s.name AS screen, r.seat, r.rating, r.note, r.transaction_id, r.created_at
           FROM seat_records r JOIN venues v ON v.id = r.venue_id LEFT JOIN screens s ON s.id = r.screen_id WHERE r.id = 'st1'`,
        )
        .first(),
    ).toEqual({
      title: "ダミー作品A",
      venue: "A映画館",
      screen: "スクリーン5",
      seat: "F-5",
      rating: 3,
      note: "ふつう",
      transaction_id: "tx1",
      created_at: NOW.toISOString(),
    });
  });

  it("null の項目は省略扱い。id がなければ採番する", async () => {
    const res = await doImport(jsonl({ type: "seat_record", date: "2026-10-10", venue: "A映画館", seat: "F-5", screen: null, rating: null, note: null, title: null, transaction_id: null }));
    expect(res.results[0]).toMatchObject({ status: "ok", id: expect.any(String) });
  });

  it("title の無い旧形式の行も取り込める(title は NULL)。空文字の title も NULL", async () => {
    const res = await doImport(jsonl(seat({ id: "old" }), seat({ id: "blank", title: "  " })));
    expect(res.results.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(await db().prepare("SELECT id, title FROM seat_records ORDER BY id").all()).toMatchObject({ results: [{ id: "blank", title: null }, { id: "old", title: null }] });
  });

  it("title が長すぎる行はその行だけエラー", async () => {
    const res = await doImport(jsonl(seat({ id: "long", title: "あ".repeat(101) }), seat({ id: "ok", title: "あ".repeat(100) })));
    expect(res.results.map((r) => r.status)).toEqual(["error", "ok"]);
  });

  it("同じ id は何度戻しても増えない(skipped_exists)", async () => {
    await doImport(jsonl(seat()));
    const again = await doImport(jsonl(seat()));
    expect(again.results[0]).toMatchObject({ status: "skipped_exists", id: "st1" });
    expect(await count("seat_records")).toBe(1);
  });

  it("評価の範囲外・必須なし・日付不正・未知の項目・存在しない取引は、その行だけエラー", async () => {
    const res = await doImport(
      jsonl(
        seat({ id: "a", rating: 6 }),
        seat({ id: "b", rating: 0 }),
        seat({ id: "c", venue: undefined }),
        seat({ id: "d", seat: undefined }),
        seat({ id: "e", date: "2026-02-30" }),
        seat({ id: "f", unknown_field: "x" }),
        seat({ id: "g", transaction_id: "none" }),
        seat({ id: "h", rating: 2.5 }),
        seat({ id: "ok", rating: 5 }),
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "error", "error", "error", "error", "error", "error", "ok"]);
    expect(res.results[6]!.message).toContain("という取引はありません");
    expect(await count("seat_records")).toBe(1);
  });

  it("既存の type の取り込みは変わらない(未対応の type のエラー文に seat_record が出る)", async () => {
    const res = await doImport(jsonl({ type: "nope" }));
    expect(res.results[0]).toMatchObject({ status: "error", message: expect.stringContaining("seat_record") });
  });
});

describe("会場・スクリーンのバックアップ", () => {
  it("seat_record の取り込みで、会場・スクリーンを名前から find-or-create する(同じ名前は1件にまとまる)", async () => {
    await doImport(jsonl(seat({ id: "a", screen: "スクリーン5" }), seat({ id: "b", screen: "スクリーン5", seat: "G-1" }), seat({ id: "c", venue: "B劇場", seat: "1列3番" })));
    expect(await count("venues")).toBe(2);
    expect(await count("screens")).toBe(1);
    expect(await count("seat_records")).toBe(3);
  });

  it("type=screen の行は note つきで取り込め、seat_record より後ろに書いてあっても先に入る。往復で note が残る", async () => {
    const res = await doImport(
      jsonl(seat({ id: "a", screen: "スクリーン5" }), { type: "screen", id: "sc1", venue: "A映画館", name: "スクリーン5", note: "前方は首が疲れる", created_at: "2026-10-01T00:00:00.000Z" }),
    );
    expect(res.summary).toMatchObject({ errors: 0, ok: 2 });
    expect(await db().prepare("SELECT id, name, note, created_at FROM screens").all()).toMatchObject({
      results: [{ id: "sc1", name: "スクリーン5", note: "前方は首が疲れる", created_at: "2026-10-01T00:00:00.000Z" }],
    });
    expect(await count("screens")).toBe(1);

    const before = await new Response(exportJsonl(db())).text();
    await db().exec("DELETE FROM seat_records");
    await db().exec("DELETE FROM screens");
    await db().exec("DELETE FROM venues");
    await doImport(before);
    expect(await new Response(exportJsonl(db())).text()).toBe(before);
  });

  it("同じ(会場, スクリーン名)や同じ id の screen は skipped_exists。既存の note は変えない。不正な行だけエラー", async () => {
    await doImport(jsonl({ type: "screen", id: "sc1", venue: "A映画館", name: "スクリーン5", note: "元のメモ" }));
    const res = await doImport(
      jsonl(
        { type: "screen", id: "sc1", venue: "A映画館", name: "スクリーン5", note: "新" },
        { type: "screen", id: "sc2", venue: "A映画館", name: "スクリーン5", note: "新" },
        { type: "screen", venue: "A映画館", name: "" },
        { type: "screen", venue: "A映画館", name: "スクリーン6", unknown_field: 1 },
        { type: "screen", venue: "A映画館", name: "スクリーン7", note: "あ".repeat(201) },
        { type: "screen", venue: "A映画館", name: "スクリーン8" },
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["skipped_exists", "skipped_exists", "error", "error", "error", "ok"]);
    expect(await db().prepare("SELECT note FROM screens WHERE id = 'sc1'").first()).toEqual({ note: "元のメモ" });
    expect(await count("screens")).toBe(2);
  });

  it("会場・スクリーンが別のレコードになる前の形式のバックアップ(venue / screen が名前の seat_record だけ)も読める", async () => {
    const old = jsonl(
      { type: "seat_record", id: "o1", date: "2026-09-01", venue: "旧A映画館", screen: "スクリーン1", seat: "A-1", rating: 3, created_at: "2026-09-01T03:00:00.000Z" },
      { type: "seat_record", id: "o2", date: "2026-09-02", venue: "旧A映画館", seat: "B-2", created_at: "2026-09-02T03:00:00.000Z" },
    );
    const res = await doImport(old);
    expect(res.summary).toMatchObject({ errors: 0, ok: 2 });
    const rows = await exportRecords();
    expect(rows.filter((r) => r.type === "seat_record").map((r) => ({ id: r.id, venue: r.venue, screen: r.screen ?? null }))).toEqual([
      { id: "o1", venue: "旧A映画館", screen: "スクリーン1" },
      { id: "o2", venue: "旧A映画館", screen: null },
    ]);
  });
});
