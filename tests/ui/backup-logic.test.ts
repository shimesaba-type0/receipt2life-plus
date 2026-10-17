import { describe, expect, it } from "vitest";
import {
  IMPORT_FILE_MAX_BYTES,
  IMPORT_FILE_MAX_LINES,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_LINES,
  errorLines,
  formatErrorLine,
  formatFileSize,
  importHttpError,
  importInChunks,
  planImportChunks,
  reportHref,
  reportQuery,
  summarizeImport,
  validateImportFile,
  validateImportText,
  type ImportResponse,
  type ImportRow,
} from "../../ui/src/pages/backupLogic";

const row = (line: number, status: ImportRow["status"], message?: string): ImportRow => ({ line, type: "transaction", status, ...(message ? { message } : {}) });

describe("上限", () => {
  it("サーバーと同じ値", () => {
    expect(IMPORT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(IMPORT_MAX_LINES).toBe(5000);
  });
  it("画面で選べるファイルは、サーバーの1回の上限より大きい(小分けして送るため)", () => {
    expect(IMPORT_FILE_MAX_BYTES).toBeGreaterThan(IMPORT_MAX_BYTES);
    expect(IMPORT_FILE_MAX_LINES).toBeGreaterThan(IMPORT_MAX_LINES);
  });
});

describe("formatFileSize", () => {
  it("単位を付ける", () => {
    expect(formatFileSize(0)).toBe("0B");
    expect(formatFileSize(512)).toBe("512B");
    expect(formatFileSize(1536)).toBe("1.5KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0MB");
  });
});

describe("validateImportFile(読む前に、サイズと空を見る)", () => {
  it("通常は通る", () => {
    expect(validateImportFile(1000)).toEqual({ ok: true });
    expect(validateImportFile(IMPORT_MAX_BYTES)).toEqual({ ok: true });
  });
  it("空ファイル", () => {
    const r = validateImportFile(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("空");
  });
  it("50MB超", () => {
    expect(validateImportFile(IMPORT_MAX_BYTES + 1)).toEqual({ ok: true });
    const r = validateImportFile(IMPORT_FILE_MAX_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("50MB");
  });
});

describe("validateImportText(行数)", () => {
  it("空行は数えない", () => {
    expect(validateImportText('{"a":1}\n\n{"a":2}\n')).toEqual({ ok: true, count: 2 });
  });
  it("空白だけは断る", () => {
    expect(validateImportText("  \n\n").ok).toBe(false);
  });
  it("サーバーの1回の上限(5000行)を超えても通る。画面の上限(10万行)を超えると断る", () => {
    const line = '{"type":"event"}';
    expect(validateImportText(Array(IMPORT_MAX_LINES + 1).fill(line).join("\n"))).toEqual({ ok: true, count: IMPORT_MAX_LINES + 1 });
    const r = validateImportText(Array(IMPORT_FILE_MAX_LINES + 1).fill(line).join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("100,000行");
  });
  it("JSON配列は件数で数える", () => {
    expect(validateImportText('[{"a":1},{"a":2}]')).toEqual({ ok: true, count: 2 });
    expect(validateImportText(JSON.stringify(Array(IMPORT_MAX_LINES + 1).fill({}))).ok).toBe(true);
    expect(validateImportText(JSON.stringify(Array(IMPORT_FILE_MAX_LINES + 1).fill({}))).ok).toBe(false);
  });
  it("壊れた配列は、サーバーに判断を任せる", () => {
    expect(validateImportText("[{").ok).toBe(true);
  });
  it("BOM付きでも数える", () => {
    expect(validateImportText('﻿{"a":1}')).toEqual({ ok: true, count: 1 });
  });
});

describe("summarizeImport", () => {
  it("状態ごとに数える", () => {
    const s = summarizeImport([row(1, "ok"), row(2, "ok"), row(3, "skipped_duplicate"), row(4, "skipped_exists"), row(5, "error", "x"), row(6, "skipped_exists")]);
    expect(s).toEqual({ registered: 2, duplicate: 1, exists: 2, errors: 1, total: 6 });
  });
  it("空", () => {
    expect(summarizeImport([])).toEqual({ registered: 0, duplicate: 0, exists: 0, errors: 0, total: 0 });
  });
});

describe("エラー行の表示", () => {
  it("N行目: 理由", () => {
    expect(formatErrorLine(row(48, "error", "金額は整数の円で入れてください。"))).toBe("48行目: 金額は整数の円で入れてください。");
  });
  it("理由が無い行にも文を出す", () => {
    expect(formatErrorLine(row(3, "error"))).toBe("3行目: 読み込めませんでした");
  });
  it("エラーだけを、最大50件まで。残りは件数", () => {
    const rows = [row(1, "ok"), ...Array.from({ length: 53 }, (_, i) => row(i + 2, "error", "m"))];
    const e = errorLines(rows);
    expect(e.items).toHaveLength(50);
    expect(e.items[0]).toBe("2行目: m");
    expect(e.more).toBe(3);
  });
  it("50件以内なら more は 0", () => {
    expect(errorLines([row(1, "error", "a")])).toEqual({ items: ["1行目: a"], more: 0 });
    expect(errorLines([row(1, "ok")])).toEqual({ items: [], more: 0 });
  });
});

describe("importHttpError", () => {
  it("サーバーの文があればそれを使う", () => {
    expect(importHttpError(413, "本文が大きすぎます(上限は5MB)。")).toBe("本文が大きすぎます(上限は5MB)。");
  });
  it("文が無いときのステータス別", () => {
    expect(importHttpError(413)).toContain("大きすぎ");
    expect(importHttpError(400)).toContain("読み込めません");
    expect(importHttpError(403)).toContain("同じサイト");
    expect(importHttpError(500)).toContain("500");
  });
});

describe("reportQuery(Markdown / HTML の期間)", () => {
  const v = { month: "2026-10", year: "2026", from: "2026-10-01", to: "2026-10-31" };
  it("月・年・期間のクエリを作る", () => {
    expect(reportQuery("month", v)).toEqual({ ok: true, query: "month=2026-10" });
    expect(reportQuery("year", v)).toEqual({ ok: true, query: "year=2026" });
    expect(reportQuery("range", v)).toEqual({ ok: true, query: "from=2026-10-01&to=2026-10-31" });
  });
  it("足りない・逆順・366日超は理由つきで断る", () => {
    expect(reportQuery("month", { ...v, month: "" }).ok).toBe(false);
    expect(reportQuery("year", { ...v, year: "26" }).ok).toBe(false);
    expect(reportQuery("range", { ...v, from: "" }).ok).toBe(false);
    expect(reportQuery("range", { ...v, from: "2026-11-01" }).ok).toBe(false);
    expect(reportQuery("range", { ...v, from: "2025-01-01", to: "2026-01-02" }).ok).toBe(false);
    expect(reportQuery("range", { ...v, from: "2028-01-01", to: "2028-12-31" }).ok).toBe(true);
  });
  it("リンクは /export/<形式>?<クエリ>", () => {
    expect(reportHref("markdown", "month=2026-10")).toBe("/export/markdown?month=2026-10");
    expect(reportHref("html", "year=2026")).toBe("/export/html?year=2026");
  });
});

const jl = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");
const ev = (id: string) => ({ type: "event", id });
const tx = (id: string) => ({ type: "transaction", id });
const item = (id: string, transaction_id: string) => ({ type: "item", id, transaction_id });

describe("planImportChunks(大きなファイルを小分けにする)", () => {
  it("小さなファイルは1つの塊。行番号は元のまま", () => {
    const chunks = planImportChunks(jl(ev("e1"), tx("t1"), item("i1", "t1")));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.origLines).toEqual([1, 2, 3]);
  });

  it("取引と明細は、必ず同じ塊に入れる(明細が別の塊の取引を指さない)。取引の直後に、その明細が並ぶ", () => {
    // 書き出しの順: 取引が先に並び、明細は後ろにまとまっている
    const lines = jl(tx("t1"), tx("t2"), tx("t3"), item("i1", "t1"), item("i2", "t2"), item("i3", "t3"), item("i4", "t1"));
    const chunks = planImportChunks(lines, 4); // 1塊は4行まで
    const types = chunks.map((c) => c.text.trim().split("\n").map((l) => JSON.parse(l) as { type: string; id: string; transaction_id?: string }));
    for (const rows of types) {
      for (const r of rows) {
        if (r.type === "item") expect(rows.some((x) => x.type === "transaction" && x.id === r.transaction_id)).toBe(true);
      }
    }
    // 全部の行が、1回ずつ入っている
    expect(chunks.flatMap((c) => c.origLines).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // t1 とその明細(2つ)は一体(3行)
    const first = types[0]!;
    expect(first.filter((r) => r.type === "item").map((r) => r.id)).toEqual(["i1", "i4"]);
  });

  it("取引のない明細の行や、そのほかの種類の行は、元の順のまま", () => {
    const chunks = planImportChunks(jl(ev("e1"), ev("e2"), item("i9", "no-such-tx"), { type: "link", id: "l1" }), 2);
    expect(chunks.map((c) => c.origLines)).toEqual([[1, 2], [3, 4]]);
  });

  it("空行は飛ばし、行番号は元のファイルの行(空行を含めた番号)に合わせる", () => {
    const chunks = planImportChunks(`${JSON.stringify(ev("e1"))}\n\n${JSON.stringify(ev("e2"))}\n`);
    expect(chunks[0]!.origLines).toEqual([1, 3]);
  });

  it("壊れた行も、そのまま送る(判定はサーバーが行う)。JSON配列も受け付ける", () => {
    expect(planImportChunks("not json\n")[0]!.text).toBe("not json\n");
    const arr = planImportChunks(JSON.stringify([ev("e1"), ev("e2")]));
    expect(arr[0]!.origLines).toEqual([1, 2]);
  });

  it("5000行を超えるファイルも、1回5000行以内の塊になる(既定は400行)", () => {
    const rows = Array.from({ length: 5200 }, (_, i) => ev(`e${i}`));
    const chunks = planImportChunks(jl(...rows));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.origLines.length).toBeLessThanOrEqual(400);
    expect(chunks.flatMap((c) => c.origLines)).toHaveLength(5200);
  });

  it("バイト数でも分ける", () => {
    const big = "x".repeat(300);
    const rows = Array.from({ length: 10 }, (_, i) => ({ type: "event", id: `e${i}`, note: big }));
    const chunks = planImportChunks(jl(...rows), 1000, 1000);
    expect(chunks.length).toBeGreaterThan(2);
  });
});

describe("importInChunks(順に送って、結果を1つにまとめる)", () => {
  const okRes = (rows: ImportRow[]): ImportResponse & { status: number } => ({ ok: true, status: 200, summary: { total: rows.length, ok: 0, skipped: 0, errors: 0 }, results: rows });
  const noSleep = async () => undefined;

  it("塊ごとの結果を足し、行番号を元のファイルの行に直す", async () => {
    const chunks = [
      { text: "a\nb\n", origLines: [1, 5] },
      { text: "c\n", origLines: [9] },
    ];
    const sent: string[] = [];
    const out = await importInChunks(
      chunks,
      async (body) => {
        sent.push(body);
        return okRes(body === "a\nb\n" ? [row(1, "ok"), row(2, "error", "だめ")] : [row(1, "skipped_exists")]);
      },
      { sleep: noSleep },
    );
    expect(sent).toEqual(["a\nb\n", "c\n"]);
    expect(out.kind).toBe("done");
    if (out.kind === "done") expect(out.rows.map((r) => [r.line, r.status])).toEqual([[1, "ok"], [5, "error"], [9, "skipped_exists"]]);
  });

  it("途中で失敗したら、そこで止まり、読めた分の結果と、何回目で止まったかを返す", async () => {
    const chunks = [1, 2, 3].map((n) => ({ text: `${n}\n`, origLines: [n] }));
    let n = 0;
    const out = await importInChunks(chunks, async () => {
      n++;
      return n === 2 ? { ok: false, status: 500, error: "" } : okRes([row(1, "ok")]);
    }, { sleep: noSleep });
    expect(out.kind).toBe("stopped");
    if (out.kind === "stopped") {
      expect(out.failedAt).toBe(2);
      expect(out.total).toBe(3);
      expect(out.rows).toHaveLength(1);
      expect(out.message).toContain("500");
    }
    expect(n).toBe(2);
  });

  it("429(回数の制限)は、待って送り直す。続けて失敗したら止まる", async () => {
    const waits: number[] = [];
    let calls = 0;
    const ok = await importInChunks([{ text: "x\n", origLines: [1] }], async () => {
      calls++;
      return calls < 3 ? { ok: false, status: 429, error: "" } : okRes([row(1, "ok")]);
    }, { sleep: async (ms) => void waits.push(ms) });
    expect(ok.kind).toBe("done");
    expect(waits).toHaveLength(2);

    const never = await importInChunks([{ text: "x\n", origLines: [1] }], async () => ({ ok: false, status: 429, error: "" }), { sleep: noSleep });
    expect(never.kind).toBe("stopped");
  });

  it("進み具合を知らせる", async () => {
    const seen: string[] = [];
    await importInChunks([{ text: "a\n", origLines: [1] }, { text: "b\n", origLines: [2] }], async () => okRes([row(1, "ok")]), { sleep: noSleep, onProgress: (d, t) => seen.push(`${d}/${t}`) });
    expect(seen).toEqual(["0/2", "1/2", "2/2"]);
  });
});

