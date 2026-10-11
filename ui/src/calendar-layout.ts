// 月カレンダーの配置を計算する純関数(DOMに触れない。テストする)
import type { EventView } from "../../src/api/contract";
import { monthRange, weekdayIndex } from "./format";

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// 月の格子: 日曜始まりの週の配列(各週7日)。前後の月の日も含む
export function buildMonthGrid(month: string): string[][] {
  const { from, to } = monthRange(month);
  const start = addDays(from, -weekdayIndex(from));
  const end = addDays(to, 6 - weekdayIndex(to));
  const weeks: string[][] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
  }
  return weeks;
}

// 出来事の最終日。end_date が無ければ1日間
export function eventEnd(e: Pick<EventView, "start_date" | "end_date">): string {
  return e.end_date && e.end_date >= e.start_date ? e.end_date : e.start_date;
}

export interface Band {
  event: EventView;
  // 週内の列(0=日〜6=土)。両端を含む
  startCol: number;
  endCol: number;
  lane: number;
  // 前の週・次の週へ続くか(端の形に使う)
  continuesBefore: boolean;
  continuesAfter: boolean;
}

// 1週間分の帯を作る。週をまたぐ出来事はこの週の分だけに切り、重なりはレーンに割り当てる
export function layoutWeekBands(week: string[], events: EventView[]): Band[] {
  const first = week[0];
  const last = week[week.length - 1];
  if (!first || !last) return [];
  const items = events
    .filter((e) => e.start_date <= last && eventEnd(e) >= first)
    .map((event) => {
      const endRaw = eventEnd(event);
      const s = event.start_date < first ? first : event.start_date;
      const e = endRaw > last ? last : endRaw;
      return {
        event,
        startCol: week.indexOf(s),
        endCol: week.indexOf(e),
        continuesBefore: event.start_date < first,
        continuesAfter: endRaw > last,
      };
    })
    // 開始が早い順、同じなら長い順、さらに id で安定させる
    .sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol || a.event.id.localeCompare(b.event.id));

  const laneEnds: number[] = []; // 各レーンで使用済みの最後の列
  return items.map((item) => {
    let lane = laneEnds.findIndex((end) => end < item.startCol);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.endCol;
    return { ...item, lane };
  });
}

export function laneCount(bands: Band[]): number {
  return bands.reduce((max, b) => Math.max(max, b.lane + 1), 0);
}
