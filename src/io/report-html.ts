import type { PeriodReport } from "../core/period-report";
import { calendarMonths, dailyAverage, dayNumber, EVENT_HEX, eventPeriod, eventsOn, exportedOn, seatLine, txHeadline, txMeta, WEEKDAYS, weekdayOf, yen } from "./report-common";

// 期間のレポートを、CSSつきの1つのHTMLファイルにする。見た目の再現にはこだわらない。
// スクリプトは入れない。外部の読み込みも無い(CSP で止める)。値はすべてエスケープする

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 保存時に検証済みのhttpsだけをリンクにする(それ以外は文字だけ)
const anchor = (url: string, text: string) =>
  url.startsWith("https://") ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);

const dot = (color: string) => `<span class="dot" style="background:${EVENT_HEX[color] ?? "#999"}"></span>`;

const CSS = `
:root{--ink:#1B2420;--paper:#F1F4F2;--green:#1F5C4B;--line:#D5DDD9;--zebra:#f4f7f5;--muted:#5f6b66}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.7 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px;color:var(--green)}
h2{font-size:19px;margin:36px 0 10px;padding-bottom:4px;border-bottom:2px solid var(--green)}
h3{font-size:16px;margin:22px 0 6px}
.sub{color:var(--muted);margin:0 0 8px}
table{border-collapse:collapse;width:100%;background:#fff}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--zebra)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:nth-child(even){background:var(--zebra)}
.bar{display:inline-block;height:10px;background:var(--green);border-radius:5px;vertical-align:middle}
.cal td{width:14.28%;height:64px;font-size:13px;padding:4px 6px}
.cal td b{display:block}
.cal td.empty{background:var(--paper)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px}
.cal .dot{margin:0 2px 0 0}
ul{padding-left:1.3em;margin:4px 0}
.day{background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:10px 0}
.day h3{margin:0 0 4px}
.amount{font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:var(--muted)}
a{color:var(--green)}
@media print{body{background:#fff}.day{break-inside:avoid}}
`;

export function renderHtml(report: PeriodReport, now: Date = new Date()): string {
  const { period } = report;
  const out: string[] = [];

  out.push(
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    `<title>${esc(period.title)}の記録</title>`,
    `<style>${CSS}</style>`,
    "</head>",
    "<body>",
    "<main>",
    `<h1>${esc(period.title)}の記録</h1>`,
    `<p class="sub">期間: ${period.from}〜${period.to} ・ 書き出し: ${exportedOn(now)}</p>`,
  );

  out.push(
    "<h2>サマリ</h2>",
    "<table><tbody>",
    `<tr><th>支出の合計</th><td class="num">${yen(report.total)}</td></tr>`,
    `<tr><th>取引(レシート)の件数</th><td class="num">${report.count}件</td></tr>`,
    `<tr><th>支出のあった日</th><td class="num">${Object.keys(report.day_totals).length}日</td></tr>`,
    `<tr><th>1日あたり(期間の日数で平均)</th><td class="num">${yen(dailyAverage(report))}</td></tr>`,
    "</tbody></table>",
  );

  out.push("<h2>カテゴリ別</h2>");
  if (report.categories.length === 0) {
    out.push("<p>この期間の支出はありません。</p>");
  } else {
    out.push('<table><thead><tr><th>カテゴリ</th><th class="num">件数</th><th class="num">金額</th><th class="num">割合</th><th></th></tr></thead><tbody>');
    for (const r of report.categories) {
      const width = Math.max(0, Math.min(100, r.percent));
      out.push(
        `<tr><td>${esc(r.label)}</td><td class="num">${r.count}</td><td class="num">${yen(r.total)}</td><td class="num">${r.percent}%</td><td><span class="bar" style="width:${width}px"></span></td></tr>`,
      );
    }
    out.push("</tbody></table>");
  }

  out.push("<h2>カレンダー</h2>", '<p class="sub">各日の下の金額は、その日の支出の合計です。色の点は、その日にかかっている期間メモです。</p>');
  for (const m of calendarMonths(period.from, period.to)) {
    out.push(`<h3>${esc(m.title)}</h3>`, '<table class="cal"><thead><tr>', ...WEEKDAYS.map((w) => `<th>${w}</th>`), "</tr></thead><tbody>");
    for (const week of m.weeks) {
      const cells = week.map((date) => {
        if (!date) return '<td class="empty"></td>';
        const total = report.day_totals[date];
        const marks = [...new Set(eventsOn(report.events, date).map((e) => e.color))].map(dot).join("");
        return `<td><b>${dayNumber(date)}</b>${total !== undefined ? `<span class="amount">${yen(total)}</span>` : ""}${marks ? `<div>${marks}</div>` : ""}</td>`;
      });
      out.push(`<tr>${cells.join("")}</tr>`);
    }
    out.push("</tbody></table>");
  }

  out.push("<h2>期間メモ</h2>");
  if (report.events.length === 0) {
    out.push("<p>この期間のメモはありません。</p>");
  } else {
    out.push("<ul>");
    for (const e of report.events) out.push(`<li>${dot(e.color)}${esc(eventPeriod(e))} <b>${esc(e.title)}</b>${e.note ? ` — ${esc(e.note)}` : ""}</li>`);
    out.push("</ul>");
  }

  out.push("<h2>日別の記録</h2>");
  if (report.days.length === 0) out.push("<p>この期間の記録はありません。</p>");
  for (const day of report.days) {
    out.push(
      '<section class="day">',
      `<h3>${day.date}(${weekdayOf(day.date)})${day.transactions.length > 0 ? ` <span class="amount">${yen(day.total)}</span>` : ""}</h3>`,
      "<ul>",
    );
    for (const e of eventsOn(report.events, day.date)) out.push(`<li>${dot(e.color)}${esc(e.title)}</li>`);
    for (const t of day.transactions) {
      const meta = txMeta(t);
      out.push(`<li><b>${esc(txHeadline(t))}</b> <span class="amount">${yen(t.amount)}</span>${meta.length > 0 ? ` <span class="muted">(${esc(meta.join(" ・ "))})</span>` : ""}`);
      const sub: string[] = [];
      if (t.memo) sub.push(`<li>メモ: ${esc(t.memo)}</li>`);
      for (const item of t.items) {
        const tail = [item.category, item.memo].filter((v): v is string => !!v);
        sub.push(`<li>${esc(item.name)} <span class="amount">${yen(item.amount)}</span>${tail.length > 0 ? ` <span class="muted">(${esc(tail.join(" ・ "))})</span>` : ""}</li>`);
      }
      for (const line of t.tax_lines) {
        const parts = [`税率${line.rate}%`];
        if (line.taxable_amount !== null) parts.push(`対象 ${yen(line.taxable_amount)}`);
        if (line.tax_amount !== null) parts.push(`税 ${yen(line.tax_amount)}`);
        sub.push(`<li class="muted">${esc(parts.join(" ・ "))}</li>`);
      }
      if (sub.length > 0) out.push(`<ul>${sub.join("")}</ul>`);
      out.push("</li>");
    }
    for (const r of day.seat_records) out.push(`<li>🎟️ ${esc(seatLine(r))}${r.note ? ` — ${esc(r.note)}` : ""}</li>`);
    if (day.photos.length > 0) {
      const captions = day.photos.map((p) => p.caption).filter((c): c is string => !!c);
      out.push(`<li>📷 写真 ${day.photos.length}枚${captions.length > 0 ? `(${esc(captions.join(" / "))})` : ""}</li>`);
    }
    for (const l of day.links) out.push(`<li>🔗 ${anchor(l.url, l.title ?? l.url)}</li>`);
    out.push("</ul>", "</section>");
  }

  out.push("</main>", "</body>", "</html>");
  return `${out.join("\n")}\n`;
}
