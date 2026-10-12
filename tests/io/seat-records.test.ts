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
  it("type=seat_record の行が、link の後(最後)に出る。既存の type の順は変わらない", async () => {
    await doImport(jsonl(tx));
    await addSeatRecord(db(), { date: "2026-10-10", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 4, note: "見やすい", transaction_id: "tx1" }, { now: NOW });
    const rows = await exportRecords();
    expect(rows.map((r) => r.type)).toEqual(["transaction", "seat_record"]);
    expect(rows[1]).toMatchObject({
      type: "seat_record",
      date: "2026-10-10",
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
    await addSeatRecord(db(), { date: "2026-10-11", venue: "B劇場", screen: "ホール", seat: "1列3番", rating: 5, note: "最高" }, { now: NOW });
    const before = await new Response(exportJsonl(db())).text();
    await db().exec("DELETE FROM seat_records");
    await db().exec("DELETE FROM transactions");
    const res = await doImport(before);
    expect(res.summary).toMatchObject({ errors: 0, ok: 3 });
    expect(await new Response(exportJsonl(db())).text()).toBe(before);
  });
});

describe("座席の記録のインポート", () => {
  it("取り込む。順序がファイルの中で前後しても、取引の後に入る", async () => {
    const res = await doImport(jsonl(seat({ transaction_id: "tx1", screen: "スクリーン5", rating: 3, note: "ふつう" }), tx));
    expect(res.results[0]).toMatchObject({ line: 1, type: "seat_record", status: "ok", id: "st1" });
    expect(await db().prepare("SELECT venue, screen, seat, rating, note, transaction_id, created_at FROM seat_records WHERE id = 'st1'").first()).toEqual({
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
    const res = await doImport(jsonl({ type: "seat_record", date: "2026-10-10", venue: "A映画館", seat: "F-5", screen: null, rating: null, note: null, transaction_id: null }));
    expect(res.results[0]).toMatchObject({ status: "ok", id: expect.any(String) });
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
        seat({ id: "f", title: "x" }),
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
