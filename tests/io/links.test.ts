import { describe, expect, it } from "vitest";
import { addLink } from "../../src/core/links";
import { exportJsonl, importRecords, type ImportResponse } from "../../src/io/jsonl";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join("\n");
const X_POST = "https://x.com/example_user/status/1234567890";
const YT = "https://youtu.be/dQw4w9WgXcQ";

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
const event = { type: "event", id: "ev1", start_date: "2026-10-03", end_date: "2026-10-05", title: "旅行", color: "blue" };
const tx = { type: "transaction", id: "tx1", date: "2026-10-10", amount: 1280, merchant: "A店", category: "食費" };
const link = (over: Record<string, unknown> = {}) => ({ type: "link", id: "lk1", url: X_POST, date: "2026-10-10", ...over });

describe("リンクのエクスポート", () => {
  it("type=link の行が、attachment の後に出る", async () => {
    await doImport(jsonl(event, tx));
    await addLink(db(), { url: YT, title: "動画", event_id: "ev1" }, { now: NOW });
    const rows = await exportRecords();
    expect(rows.map((r) => r.type)).toEqual(["event", "transaction", "link"]);
    expect(rows[2]).toMatchObject({ type: "link", url: YT, kind: "youtube", title: "動画", date: null, transaction_id: null, event_id: "ev1", created_at: NOW.toISOString() });
  });
});

describe("リンクのインポート", () => {
  it("取り込み、URLは正規化する", async () => {
    const res = await doImport(jsonl(event, tx, link({ url: `${X_POST}?utm_source=a#x`, transaction_id: "tx1", event_id: "ev1", title: "t" })));
    expect(res.results[2]).toMatchObject({ line: 3, type: "link", status: "ok", id: "lk1" });
    expect(await db().prepare("SELECT url, kind, title FROM links WHERE id = 'lk1'").first()).toEqual({ url: X_POST, kind: "x", title: "t" });
  });

  it("内部ホスト・IPアドレス・userinfo・紐づけ先なし・kind 不一致は、その行だけエラー", async () => {
    const res = await doImport(
      jsonl(
        link({ id: "a", url: "https://localhost/a" }),
        link({ id: "b", url: "https://192.168.0.1/watch?v=dQw4w9WgXcQ" }),
        link({ id: "c", url: "https://user:pw@x.com/example_user/status/1" }),
        link({ id: "d", date: undefined }),
        link({ id: "e", kind: "youtube" }),
        link({ id: "f", transaction_id: "none" }),
        link({ id: "g", url: YT }),
      ),
    );
    expect(res.results.map((r) => r.status)).toEqual(["error", "error", "error", "error", "error", "error", "ok"]);
    expect(res.results[0]!.message).toContain("対応しているのは");
    expect(res.results[5]!.message).toContain("という取引はありません");
    expect(await count("links")).toBe(1);
  });

  it("ファイル内の順序が逆でも、取引・出来事の後に取り込む", async () => {
    const res = await doImport(jsonl(link({ transaction_id: "tx1", date: undefined }), tx));
    expect(res.summary).toMatchObject({ ok: 2, errors: 0 });
  });

  it("同じ id は skipped_exists、id が違っても同じ紐づけ先・同じ正規化URLは skipped_duplicate", async () => {
    await doImport(jsonl(link()));
    const res = await doImport(jsonl(link(), link({ id: "other", url: `${X_POST}?s=20` }), link({ id: "third", date: "2026-10-11" })));
    expect(res.results.map((r) => r.status)).toEqual(["skipped_exists", "skipped_duplicate", "ok"]);
    expect(res.results[1]!.id).toBe("lk1");
    expect(await count("links")).toBe(2);
  });

  it("同じ本文内の重複も、後のものをスキップする", async () => {
    const res = await doImport(jsonl(link({ id: "a" }), link({ id: "b" })));
    expect(res.results.map((r) => r.status)).toEqual(["ok", "skipped_duplicate"]);
  });
});

describe("往復(export → 空にする → import)とバックアップ復元の重複", () => {
  it("リンクが同じ id・内容で戻り、もう一度取り込んでも増えない", async () => {
    await doImport(jsonl(event, tx));
    await addLink(db(), { url: YT, title: "動画", transaction_id: "tx1", date: "2026-10-10" }, { now: NOW });
    await addLink(db(), { url: X_POST, event_id: "ev1" }, { now: NOW });
    await addLink(db(), { url: "https://example.com/movie/1", title: "公式ページ", description: "上映館の案内", date: "2026-10-10" }, { now: NOW });
    const before = await exportRecords();
    const text = before.map((r) => JSON.stringify(r)).join("\n");

    await db().exec("DELETE FROM links");
    await db().exec("DELETE FROM events");
    await db().exec("DELETE FROM transactions");
    const restored = await doImport(text);
    expect(restored.summary).toMatchObject({ ok: 5, errors: 0, skipped: 0 });
    expect(await exportRecords()).toEqual(before);

    const again = await doImport(text);
    expect(again.summary).toMatchObject({ ok: 0, errors: 0, skipped: 5 });
    expect(await count("links")).toBe(3);
    expect(await db().prepare("SELECT kind, description FROM links WHERE kind = 'web'").first()).toEqual({ kind: "web", description: "上映館の案内" });
  });
});
