import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_LINES,
  errorLines,
  formatErrorLine,
  formatFileSize,
  importHttpError,
  summarizeImport,
  validateImportFile,
  validateImportText,
  type ImportRow,
} from "../../ui/src/pages/backupLogic";

const row = (line: number, status: ImportRow["status"], message?: string): ImportRow => ({ line, type: "transaction", status, ...(message ? { message } : {}) });

describe("上限", () => {
  it("サーバーと同じ値", () => {
    expect(IMPORT_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(IMPORT_MAX_LINES).toBe(5000);
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
  it("5MB超", () => {
    const r = validateImportFile(IMPORT_MAX_BYTES + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("5MB");
  });
});

describe("validateImportText(行数)", () => {
  it("空行は数えない", () => {
    expect(validateImportText('{"a":1}\n\n{"a":2}\n')).toEqual({ ok: true, count: 2 });
  });
  it("空白だけは断る", () => {
    expect(validateImportText("  \n\n").ok).toBe(false);
  });
  it("5000行ちょうどは通り、超えると断る", () => {
    const line = '{"type":"event"}';
    expect(validateImportText(Array(IMPORT_MAX_LINES).fill(line).join("\n"))).toEqual({ ok: true, count: IMPORT_MAX_LINES });
    const r = validateImportText(Array(IMPORT_MAX_LINES + 1).fill(line).join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("5,000行");
  });
  it("JSON配列は件数で数える", () => {
    expect(validateImportText('[{"a":1},{"a":2}]')).toEqual({ ok: true, count: 2 });
    const r = validateImportText(JSON.stringify(Array(IMPORT_MAX_LINES + 1).fill({})));
    expect(r.ok).toBe(false);
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
