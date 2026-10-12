import type { PeriodReport } from "../core/period-report";
import { calendarMonths, dailyAverage, dayNumber, emojiOf, eventPeriod, eventsOn, exportedOn, seatLine, txHeadline, txMeta, WEEKDAYS, weekdayOf, yen } from "./report-common";

// 期間のレポートを Markdown にする(書き出しのみ)。写真の実体は含めない(件数とキャプションだけ)

// 行の中で記号として解釈されないようにする(改行は空白に)
const md = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/([\\`*_[\]<>|~])/g, "\\$1");

// Mermaid の円グラフのラベル。ダブルクォートと改行は使えない
const mermaidLabel = (s: string) => s.replace(/["\n\r]/g, " ").trim();

// リンク先。対応しているのは https のみ(保存時に検証済み)。括弧と空白は読み違えないよう符号化する
const linkTarget = (url: string) => url.replaceAll(" ", "%20").replaceAll("(", "%28").replaceAll(")", "%29");

export function renderMarkdown(report: PeriodReport, now: Date = new Date()): string {
  const out: string[] = [];
  const { period } = report;

  out.push(`# ${md(period.title)}の記録`, "", `期間: ${period.from}〜${period.to} ・ 書き出し: ${exportedOn(now)}`, "");

  out.push(
    "## サマリ",
    "",
    "| 項目 | 値 |",
    "| --- | --- |",
    `| 支出の合計 | ${yen(report.total)} |`,
    `| 取引(レシート)の件数 | ${report.count}件 |`,
    `| 支出のあった日 | ${Object.keys(report.day_totals).length}日 |`,
    `| 1日あたり(期間の日数で平均) | ${yen(dailyAverage(report))} |`,
    "",
  );

  out.push("## カテゴリ別", "");
  if (report.categories.length === 0) {
    out.push("この期間の支出はありません。", "");
  } else {
    out.push("| カテゴリ | 件数 | 金額 | 割合 |", "| --- | ---: | ---: | ---: |");
    for (const r of report.categories) out.push(`| ${md(r.label)} | ${r.count} | ${yen(r.total)} | ${r.percent}% |`);
    out.push("");
    const positive = report.categories.filter((r) => r.total > 0);
    if (positive.length > 0) {
      out.push("```mermaid", "pie showData title カテゴリ別の支出");
      for (const r of positive) out.push(`  "${mermaidLabel(r.label)}" : ${r.total}`);
      out.push("```", "");
    }
  }

  out.push("## カレンダー", "", "各日の下の金額は、その日の支出の合計です。絵文字は、その日にかかっている期間メモの色です。", "");
  for (const m of calendarMonths(period.from, period.to)) {
    out.push(`### ${m.title}`, "", `| ${WEEKDAYS.join(" | ")} |`, `| ${WEEKDAYS.map(() => "---").join(" | ")} |`);
    for (const week of m.weeks) {
      const cells = week.map((date) => {
        if (!date) return " ";
        const parts = [dayNumber(date)];
        const total = report.day_totals[date];
        if (total !== undefined) parts.push(yen(total));
        const marks = eventsOn(report.events, date).map((e) => emojiOf(e.color));
        if (marks.length > 0) parts.push([...new Set(marks)].join(""));
        return parts.join("<br>");
      });
      out.push(`| ${cells.join(" | ")} |`);
    }
    out.push("");
  }

  out.push("## 期間メモ", "");
  if (report.events.length === 0) {
    out.push("この期間のメモはありません。", "");
  } else {
    for (const e of report.events) out.push(`- ${emojiOf(e.color)} ${eventPeriod(e)} **${md(e.title)}**${e.note ? ` — ${md(e.note)}` : ""}`);
    out.push("");
  }

  out.push("## 日別の記録", "");
  if (report.days.length === 0) {
    out.push("この期間の記録はありません。", "");
  }
  for (const day of report.days) {
    out.push(`### ${day.date}(${weekdayOf(day.date)})${day.transactions.length > 0 ? ` ${yen(day.total)}` : ""}`, "");
    for (const e of eventsOn(report.events, day.date)) out.push(`- ${emojiOf(e.color)} ${md(e.title)}`);
    for (const t of day.transactions) {
      const meta = txMeta(t);
      out.push(`- **${md(txHeadline(t))}** ${yen(t.amount)}${meta.length > 0 ? `(${md(meta.join(" ・ "))})` : ""}`);
      if (t.memo) out.push(`  - メモ: ${md(t.memo)}`);
      for (const item of t.items) {
        const tail = [item.category, item.memo].filter((v): v is string => !!v);
        out.push(`  - ${md(item.name)} ${yen(item.amount)}${tail.length > 0 ? `(${md(tail.join(" ・ "))})` : ""}`);
      }
      for (const line of t.tax_lines) {
        const parts = [`税率${line.rate}%`];
        if (line.taxable_amount !== null) parts.push(`対象 ${yen(line.taxable_amount)}`);
        if (line.tax_amount !== null) parts.push(`税 ${yen(line.tax_amount)}`);
        out.push(`  - ${parts.join(" ・ ")}`);
      }
    }
    for (const r of day.seat_records) out.push(`- 🎟️ ${md(seatLine(r))}${r.note ? ` — ${md(r.note)}` : ""}`);
    if (day.photos.length > 0) {
      const captions = day.photos.map((p) => p.caption).filter((c): c is string => !!c);
      out.push(`- 📷 写真 ${day.photos.length}枚${captions.length > 0 ? `(${md(captions.join(" / "))})` : ""}`);
    }
    for (const l of day.links) out.push(`- 🔗 [${md(l.title ?? l.url)}](${linkTarget(l.url)})`);
    out.push("");
  }

  return `${out.join("\n").trimEnd()}\n`;
}
