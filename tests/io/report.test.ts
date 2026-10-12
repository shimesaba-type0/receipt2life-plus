import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { addEvent } from "../../src/core/events";
import { buildPeriodReport, resolveReportPeriod } from "../../src/core/period-report";
import { addTransactions } from "../../src/core/transactions";
import { renderHtml } from "../../src/io/report-html";
import { renderMarkdown } from "../../src/io/report-markdown";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const app = createApp();
const local = () => ({ DB: db(), AUTH_BYPASS: "1" });

async function seed() {
  const tx = await addTransactions(db(), { transactions: [
    { date: "2026-10-03", amount: 1280, merchant: "A店|*dummy*", category: "食費", account: "現金", paid_time: "12:30", memo: "昼食" },
    {
      date: "2026-10-03",
      amount: 300,
      merchant: "B店",
      category: "日用品",
      account: "カード",
      items: [
        { name: "品物1", amount: 200 },
        { name: "品物2", amount: 100 },
      ],
    },
    { date: "2026-10-09", amount: 500, merchant: "<script>alert(1)</script>", category: "食費", account: "現金" },
    { date: "2026-09-30", amount: 999, merchant: "範囲外の店", category: "食費", account: "現金" },
  ] }, { now: NOW });
  if (!tx.ok) throw new Error(JSON.stringify(tx.errors));
  expect(tx.ok).toBe(true);
  const ev = await addEvent(db(), { title: "出張", start_date: "2026-10-03", end_date: "2026-10-05", color: "blue", note: "ダミーの出張" }, { now: NOW });
  expect(ev.ok).toBe(true);
}

describe("resolveReportPeriod", () => {
  it("月: 月初から月末まで", () => {
    expect(resolveReportPeriod({ month: "2026-02" })).toEqual({ ok: true, period: { from: "2026-02-01", to: "2026-02-28", title: "2026年2月", slug: "2026-02" } });
  });
  it("年", () => {
    expect(resolveReportPeriod({ year: "2026" })).toMatchObject({ ok: true, period: { from: "2026-01-01", to: "2026-12-31", slug: "2026" } });
  });
  it("期間", () => {
    expect(resolveReportPeriod({ from: "2026-10-01", to: "2026-10-15" })).toMatchObject({ ok: true, period: { slug: "20261001-20261015" } });
  });
  it("何も無ければ今月", () => {
    expect(resolveReportPeriod({}, { now: NOW })).toMatchObject({ ok: true, period: { from: "2026-10-01", to: "2026-10-31" } });
  });
  it("複数の指定・片方だけ・逆順・長すぎる期間・実在しない日付はエラー", () => {
    expect(resolveReportPeriod({ month: "2026-10", year: "2026" }).ok).toBe(false);
    expect(resolveReportPeriod({ from: "2026-10-01" }).ok).toBe(false);
    expect(resolveReportPeriod({ from: "2026-10-05", to: "2026-10-01" }).ok).toBe(false);
    expect(resolveReportPeriod({ from: "2025-01-01", to: "2026-01-02" }).ok).toBe(false);
    expect(resolveReportPeriod({ from: "2026-02-30", to: "2026-03-01" }).ok).toBe(false);
    expect(resolveReportPeriod({ month: "2026-13" }).ok).toBe(false);
    expect(resolveReportPeriod({ x: "1" }).ok).toBe(false);
  });
  it("うるう年の1年(366日)は書き出せる", () => {
    expect(resolveReportPeriod({ from: "2028-01-01", to: "2028-12-31" }).ok).toBe(true);
  });
});

describe("buildPeriodReport と描画", () => {
  it("期間内の記録だけを集める", async () => {
    await seed();
    const resolved = resolveReportPeriod({ month: "2026-10" });
    if (!resolved.ok) throw new Error("period");
    const r = await buildPeriodReport(db(), resolved.period);
    if (!r.ok) throw new Error("report");
    expect(r.total).toBe(2080);
    expect(r.count).toBe(3);
    expect(r.day_totals).toEqual({ "2026-10-03": 1580, "2026-10-09": 500 });
    expect(r.days.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-09"]);
    expect(r.events).toHaveLength(1);
  });

  it("Markdown: サマリ・カテゴリ・円グラフ・カレンダー・期間メモ・日別を出し、記号をエスケープする", async () => {
    await seed();
    const resolved = resolveReportPeriod({ month: "2026-10" });
    if (!resolved.ok) throw new Error("period");
    const r = await buildPeriodReport(db(), resolved.period);
    if (!r.ok) throw new Error("report");
    const md = renderMarkdown(r, NOW);
    expect(md).toContain("# 2026年10月の記録");
    expect(md).toContain("| 支出の合計 | ¥2,080 |");
    expect(md).toContain("```mermaid\npie showData");
    expect(md).toContain('"食費" : 1780');
    expect(md).toContain("### 2026年10月");
    expect(md).toContain("🟦 2026-10-03〜2026-10-05 **出張** — ダミーの出張");
    expect(md).toContain("### 2026-10-03(土) ¥1,580");
    expect(md).toContain("**A店\\|\\*dummy\\*** ¥1,280");
    expect(md).toContain("  - 品物1 ¥200");
    expect(md).toContain("<br>🟦");
    expect(md).not.toContain("範囲外の店");
    // 生のタグは文字として出す
    expect(md).toContain("\\<script\\>");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("HTML: 1つのファイル。値はエスケープされ、スクリプトを含まない", async () => {
    await seed();
    const resolved = resolveReportPeriod({ month: "2026-10" });
    if (!resolved.ok) throw new Error("period");
    const r = await buildPeriodReport(db(), resolved.period);
    if (!r.ok) throw new Error("report");
    const html = renderHtml(r, NOW);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("<b>出張</b>");
  });

  it("記録の無い期間でも、文書ができる", async () => {
    const resolved = resolveReportPeriod({ month: "2030-01" });
    if (!resolved.ok) throw new Error("period");
    const r = await buildPeriodReport(db(), resolved.period);
    if (!r.ok) throw new Error("report");
    expect(renderMarkdown(r, NOW)).toContain("この期間の支出はありません。");
    expect(renderHtml(r, NOW)).toContain("この期間の記録はありません。");
  });
});

describe("GET /export/markdown と /export/html", () => {
  it("未認証は401", async () => {
    expect((await app.request("http://example.test/export/markdown", {}, { DB: db() })).status).toBe(401);
    expect((await app.request("http://example.test/export/html", {}, { DB: db() })).status).toBe(401);
  });

  it("Markdown をダウンロード用のヘッダーつきで返す", async () => {
    await seed();
    const res = await app.request("http://localhost/export/markdown?month=2026-10", {}, local());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="receipt2life-2026-10.md"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("| 支出の合計 | ¥2,080 |");
  });

  it("HTML をダウンロード用のヘッダーつきで返す", async () => {
    await seed();
    const res = await app.request("http://localhost/export/html?from=2026-10-01&to=2026-10-31", {}, local());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="receipt2life-20261001-20261031.html"');
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).toContain("<!doctype html>");
  });

  it("期間が正しくなければ400", async () => {
    const res = await app.request("http://localhost/export/markdown?month=2026-13", {}, local());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
    const res2 = await app.request("http://localhost/export/html?from=2026-10-01", {}, local());
    expect(res2.status).toBe(400);
  });
});
