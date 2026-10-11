import { describe, expect, it } from "vitest";
import { addTransactions } from "../../src/core/transactions";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");

async function exportText(): Promise<string> {
  return new Response(exportJsonl(db())).text();
}

async function exportRecords(): Promise<Record<string, unknown>[]> {
  const text = await exportText();
  return text === "" ? [] : text.trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function doImport(text: string): Promise<Extract<ImportResponse, { ok: true }>> {
  const res = await importRecords(db(), text, { now: NOW });
  if (!res.ok) throw new Error(`import failed: ${res.error}`);
  return res;
}

async function seedTransaction(overrides: Record<string, unknown> = {}) {
  const res = await addTransactions(
    db(),
    { transactions: [{ date: "2026-10-10", amount: 1280, merchant: "A店", category: "食費", account: "現金", memo: "昼ごはん", source: "receipt", ...overrides }] },
    { now: NOW },
  );
  if (!res.ok) throw new Error("seed failed");
  return res.registered[0]!;
}

const count = async (table: string) => (await db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const event = (over: Record<string, unknown> = {}) => ({ type: "event", id: "ev1", start_date: "2026-10-03", end_date: "2026-10-05", title: "出張", color: "blue", ...over });
const tx = (over: Record<string, unknown> = {}) => ({ type: "transaction", id: "tx1", date: "2026-10-10", amount: 1280, merchant: "A店", category: "食費", account: "現金", ...over });
const att = (over: Record<string, unknown> = {}) => ({ type: "attachment", id: "at1", r2_key: "photos/a.jpg", transaction_id: "tx1", ...over });

describe("exportJsonl", () => {
  it("空のDBは空の出力", async () => {
    expect(await exportText()).toBe("");
  });

  it("event → transaction → attachment の順で、1行1レコード", async () => {
    const t = await seedTransaction();
    await db().batch([
      db().prepare("INSERT INTO events (id, start_date, end_date, title, note, color, created_at, updated_at) VALUES ('ev1','2026-10-03','2026-10-05','出張','メモ','red','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')"),
      db().prepare("INSERT INTO attachments (id, r2_key, date, transaction_id, event_id, caption, created_at) VALUES ('at1','photos/a.jpg',NULL,?,NULL,'レシート','2026-10-10T00:00:00.000Z')").bind(t.id),
    ]);
    const text = await exportText();
    expect(text.endsWith("\n")).toBe(true);
    const rows = await exportRecords();
    expect(rows.map((r) => r.type)).toEqual(["event", "transaction", "attachment"]);
    expect(rows[0]).toEqual({
      type: "event",
      id: "ev1",
      start_date: "2026-10-03",
      end_date: "2026-10-05",
      title: "出張",
      note: "メモ",
      color: "red",
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    });
    expect(rows[1]).toEqual({
      type: "transaction",
      id: t.id,
      date: "2026-10-10",
      amount: 1280,
      merchant: "A店",
      category: "食費",
      account: "現金",
      memo: "昼ごはん",
      source: "receipt",
      status: "ok",
      tax_flag: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    expect(rows[2]).toEqual({
      type: "attachment",
      id: "at1",
      r2_key: "photos/a.jpg",
      date: null,
      transaction_id: t.id,
      event_id: null,
      caption: "レシート",
      created_at: "2026-10-10T00:00:00.000Z",
    });
  });

  it("null の項目も省略せず出す。日本語はそのまま出す", async () => {
    await addTransactions(db(), { transactions: [{ date: "2026-10-10", amount: 500 }] }, { now: NOW });
    const text = await exportText();
    expect(text).toContain('"merchant":null');
    expect(text).toContain('"category":null');
    expect(text).toContain('"account":null');
    expect(text).toContain('"memo":null');
    await seedTransaction({ amount: 999, merchant: "日本語の店" });
    expect(await exportText()).toContain("日本語の店");
  });

  it("多数の行も分割して読み出し、全件を出す", async () => {
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 1200; i++) {
      stmts.push(
        db()
          .prepare("INSERT INTO transactions (id, date, amount, source, status, dedup_hash, created_at, updated_at) VALUES (?, '2026-10-01', ?, 'manual', 'ok', ?, 'c', 'u')")
          .bind(`id${String(i).padStart(5, "0")}`, i + 1, `h${i}`),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) await db().batch(stmts.slice(i, i + 100));
    const rows = await exportRecords();
    expect(rows).toHaveLength(1200);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1200);
  });
});

describe("importRecords", () => {
  it("event・transaction・attachment を取り込み、行ごとの結果を返す", async () => {
    const res = await doImport(jsonl(event(), tx(), att()));
    expect(res.summary).toEqual({ total: 3, ok: 3, skipped: 0, errors: 0 });
    expect(res.results).toEqual([
      { line: 1, type: "event", status: "ok", id: "ev1" },
      { line: 2, type: "transaction", status: "ok", id: "tx1" },
      { line: 3, type: "attachment", status: "ok", id: "at1" },
    ]);
    const row = await db().prepare("SELECT category_id, account_id, status, source FROM transactions WHERE id='tx1'").first();
    expect(row).toEqual({ category_id: "cat_food", account_id: "acc_cash", status: "ok", source: "manual" });
  });

  it("id 省略は新規採番。status 省略は店名とカテゴリで決める", async () => {
    const res = await doImport(jsonl(tx({ id: undefined }), tx({ id: undefined, amount: 300, category: null }), event({ id: undefined })));
    expect(res.summary.ok).toBe(3);
    for (const r of res.results) expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await db().prepare("SELECT amount, status FROM transactions ORDER BY amount").all();
    expect(rows.results).toEqual([
      { amount: 300, status: "needs_review" },
      { amount: 1280, status: "ok" },
    ]);
  });

  it("status、created_at、updated_at、null の項目を受け取れる", async () => {
    await doImport(
      jsonl(tx({ status: "needs_review", merchant: null, memo: null, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" })),
    );
    const row = await db().prepare("SELECT merchant, memo, status, created_at, updated_at FROM transactions WHERE id='tx1'").first();
    expect(row).toEqual({ merchant: null, memo: null, status: "needs_review", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" });
  });

  it("id が既にあれば skipped_exists", async () => {
    await doImport(jsonl(event(), tx(), att()));
    const res = await doImport(jsonl(event(), tx(), att()));
    expect(res.summary).toEqual({ total: 3, ok: 0, skipped: 3, errors: 0 });
    expect(res.results.map((r) => r.status)).toEqual(["skipped_exists", "skipped_exists", "skipped_exists"]);
    expect(await count("transactions")).toBe(1);
  });

  it("既存と同じ日付・金額・店名なら skipped_duplicate(入力内の重複も)", async () => {
    const existing = await seedTransaction();
    const res = await doImport(
      jsonl(
        tx({ id: "n1", merchant: "Ａ店" }),
        tx({ id: "n2", amount: 700, merchant: "B店" }),
        tx({ id: "n3", amount: 700, merchant: "b店" }),
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["skipped_duplicate", "ok", "skipped_duplicate"]);
    expect(res.results[0]!.id).toBe(existing.id);
    expect(res.results[2]!.id).toBe("n2");
    expect(await count("transactions")).toBe(2);
  });

  it("allow_duplicate:true なら重複でも取り込む", async () => {
    await seedTransaction();
    const res = await doImport(jsonl(tx({ id: "n1", allow_duplicate: true })));
    expect(res.results[0]!.status).toBe("ok");
  });

  it("エラーは行ごと。ほかの行は取り込まれる", async () => {
    const res = await doImport(
      [
        JSON.stringify(tx({ id: "ok1" })),
        "{broken",
        JSON.stringify(tx({ id: "bad1", amount: 0 })),
        JSON.stringify({ amount: 100 }),
        JSON.stringify({ type: "memo" }),
        JSON.stringify(tx({ id: "bad2", date: "2999-01-01" })),
        JSON.stringify(tx({ id: "bad3", source: "fax" })),
        "123",
        JSON.stringify(tx({ id: "ok2", amount: 50 })),
      ].join("\n"),
    );
    expect(res.summary).toEqual({ total: 9, ok: 2, skipped: 0, errors: 7 });
    expect(res.results.map((r) => r.status)).toEqual(["ok", "error", "error", "error", "error", "error", "error", "error", "ok"]);
    expect(res.results[1]!.message).toContain("JSON");
    expect(res.results[2]!.message).toContain("amount");
    expect(res.results[3]!.message).toContain("type");
    expect(res.results[4]!.message).toContain("type");
    expect(res.results[5]!.message).toContain("未来");
    expect(res.results[6]!.message).toContain("source");
    expect(await count("transactions")).toBe(2);
  });

  it("未知のカテゴリ・口座はエラー(自動作成しない)", async () => {
    const res = await doImport(jsonl(tx({ category: "存在しない" }), tx({ id: "t2", account: "ゆうちょ" })));
    expect(res.results.map((r) => r.status)).toEqual(["error", "error"]);
    expect(res.results[0]!.message).toContain("「存在しない」");
    expect(res.results[1]!.message).toContain("口座");
    expect(await count("categories")).toBe(5);
    expect(await count("accounts")).toBe(3);
  });

  it("event の検証: 終了日が開始日より前、色が不正はエラー", async () => {
    const res = await doImport(jsonl(event({ end_date: "2026-10-01" }), event({ id: "e2", color: "pink" }), event({ id: "e3", end_date: null, note: null })));
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "ok"]);
    expect(res.results[0]!.message).toContain("end_date");
  });

  it("JSON配列も受け付ける(行番号は要素の番号)", async () => {
    const res = await doImport(JSON.stringify([event(), tx(), { amount: 1 }]));
    expect(res.results.map((r) => [r.line, r.status])).toEqual([
      [1, "ok"],
      [2, "ok"],
      [3, "error"],
    ]);
  });

  it("空行は無視して、行番号は元のファイルの行を指す", async () => {
    const res = await doImport(`\n${JSON.stringify(event())}\r\n\n  \n${JSON.stringify(tx())}\n`);
    expect(res.results.map((r) => r.line)).toEqual([2, 5]);
    expect(res.summary.total).toBe(2);
  });

  it("attachment: 参照先がなければエラー、紐づけが1つもなくてもエラー", async () => {
    await doImport(jsonl(event(), tx()));
    const res = await doImport(
      jsonl(
        att({ id: "a1", transaction_id: "nope" }),
        att({ id: "a2", transaction_id: undefined, event_id: "nope" }),
        att({ id: "a3", transaction_id: undefined }),
        att({ id: "a4", r2_key: undefined }),
        att({ id: "a5", transaction_id: undefined, date: "2026-10-10", caption: null }),
        att({ id: "a6", transaction_id: null, event_id: "ev1" }),
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "error", "error", "ok", "ok"]);
    expect(res.results[0]!.message).toContain("nope");
    expect(res.results[2]!.message).toContain("transaction_id");
    expect(res.results[3]!.message).toContain("r2_key");
  });

  it("ファイル内の順序が逆でも、event → transaction → attachment の順で取り込む", async () => {
    const res = await doImport(jsonl(att({ id: "a1", event_id: "ev1" }), att({ id: "a2" }), tx(), event()));
    expect(res.results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(res.results.map((r) => r.line)).toEqual([1, 2, 3, 4]);
    expect(await count("attachments")).toBe(2);
  });

  it("取り込み済みの取引への attachment も参照できる", async () => {
    const t = await seedTransaction();
    const res = await doImport(jsonl(att({ transaction_id: t.id })));
    expect(res.results[0]!.status).toBe("ok");
  });

  it("本文が空、行数や大きさが上限を超えるときはエラー", async () => {
    for (const body of ["", "  \n \n"]) {
      const res = await importRecords(db(), body, { now: NOW });
      expect(res).toMatchObject({ ok: false, status: 400 });
    }
    const many = await importRecords(db(), Array.from({ length: 5001 }, () => "{}").join("\n"), { now: NOW });
    expect(many).toMatchObject({ ok: false, status: 413, error: expect.stringContaining("5000") });
    const big = await importRecords(db(), "x".repeat(5 * 1024 * 1024 + 1), { now: NOW });
    expect(big).toMatchObject({ ok: false, status: 413, error: expect.stringContaining("5MB") });
    const badArray = await importRecords(db(), "[1, 2", { now: NOW });
    expect(badArray).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("JSON") });
    const emptyArray = await importRecords(db(), "[]", { now: NOW });
    expect(emptyArray).toMatchObject({ ok: false, status: 400 });
  });

  it("200件程度の取り込みも分割して処理し、全件登録できる", async () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 20; i++) lines.push(event({ id: `ev${i}`, title: `出来事${i}` }));
    for (let i = 0; i < 200; i++) lines.push(tx({ id: `tx${i}`, amount: i + 1 }));
    for (let i = 0; i < 100; i++) lines.push(att({ id: `at${i}`, transaction_id: `tx${i}`, r2_key: `photos/${i}.jpg` }));
    const res = await doImport(jsonl(...lines));
    expect(res.summary).toEqual({ total: 320, ok: 320, skipped: 0, errors: 0 });
    expect(await count("transactions")).toBe(200);
    expect(await count("events")).toBe(20);
    expect(await count("attachments")).toBe(100);
    // もう一度取り込むと、全件が既存
    const again = await doImport(jsonl(...lines));
    expect(again.summary).toEqual({ total: 320, ok: 0, skipped: 320, errors: 0 });
  });
});

describe("バックアップ行(id と created_at がある transaction)の重複判定", () => {
  const backup = (over: Record<string, unknown> = {}) => tx({ created_at: "2026-10-01T00:00:00.000Z", ...over });

  it("allow_duplicate で登録した同日・同額・同店の2件が、export → 全削除 → import で2件とも戻る", async () => {
    await seedTransaction();
    await seedTransaction({ allow_duplicate: true });
    expect(await count("transactions")).toBe(2);
    const before = await exportText();
    await db().exec("DELETE FROM transactions");

    const res = await doImport(before);
    expect(res.summary).toEqual({ total: 2, ok: 2, skipped: 0, errors: 0 });
    expect(await exportText()).toBe(before);
  });

  it("入力内・既存との重複判定を飛ばす", async () => {
    await seedTransaction();
    const res = await doImport(jsonl(backup({ id: "b1" }), backup({ id: "b2" })));
    expect(res.results.map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("id と created_at の片方が無い行は、従来どおり重複でスキップされる", async () => {
    await seedTransaction();
    const res = await doImport(jsonl(tx({ id: "n1" }), backup({ id: undefined }), tx({ id: "n2", created_at: undefined })));
    expect(res.results.map((r) => r.status)).toEqual(["skipped_duplicate", "skipped_duplicate", "skipped_duplicate"]);
  });

  it("バックアップ行でも、id が既存なら skipped_exists", async () => {
    await doImport(jsonl(backup()));
    const res = await doImport(jsonl(backup()));
    expect(res.results[0]!.status).toBe("skipped_exists");
  });

  it("バックアップ行の後に出た、手書きの同じ取引は重複になる", async () => {
    const res = await doImport(jsonl(backup({ id: "b1" }), tx({ id: "n1" })));
    expect(res.results.map((r) => r.status)).toEqual(["ok", "skipped_duplicate"]);
  });
});

describe("往復(export → 空にする → import)", () => {
  it("同じ内容に戻る", async () => {
    const t1 = await seedTransaction();
    const t2 = await seedTransaction({ date: "2026-10-09", amount: 300, merchant: undefined, category: undefined, account: undefined, memo: undefined, source: "voice" });
    await db().batch([
      db().prepare("INSERT INTO events (id, start_date, end_date, title, note, color, created_at, updated_at) VALUES ('ev1','2026-10-03',NULL,'誕生日',NULL,'purple','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')"),
      db().prepare("INSERT INTO attachments (id, r2_key, date, transaction_id, event_id, caption, created_at) VALUES ('at1','photos/a.jpg','2026-10-10',?,'ev1',NULL,'2026-10-10T00:00:00.000Z')").bind(t1.id),
    ]);
    const before = await exportText();

    await db().exec("DELETE FROM attachments");
    await db().exec("DELETE FROM events");
    await db().exec("DELETE FROM transactions");
    expect(await exportText()).toBe("");

    const res = await doImport(before);
    expect(res.summary).toEqual({ total: 4, ok: 4, skipped: 0, errors: 0 });
    expect(await exportText()).toBe(before);
    const row = await db().prepare("SELECT status FROM transactions WHERE id=?").bind(t2.id).first();
    expect(row).toEqual({ status: "needs_review" });
  });
});
