import type { SearchHitType, SearchHitView } from "../../../src/api/contract";

// 検索ページの純粋な部分(DOMに触れない。テストする)

export const TYPE_LABELS: Record<SearchHitType, string> = {
  transaction: "支出",
  event: "出来事",
  seat_record: "座席",
  link: "リンク",
  photo: "写真",
};

export const TYPE_OPTIONS: { value: SearchHitType | ""; label: string }[] = [
  { value: "", label: "すべて" },
  { value: "transaction", label: TYPE_LABELS.transaction },
  { value: "event", label: TYPE_LABELS.event },
  { value: "seat_record", label: "映画・座席" },
  { value: "link", label: TYPE_LABELS.link },
  { value: "photo", label: TYPE_LABELS.photo },
];

// 画面の URL(/search?q=…&type=…)。空の言葉は /search だけ
export function searchPageHref(q: string, type: SearchHitType | null): string {
  const text = q.trim();
  if (text === "") return "/search";
  const params = new URLSearchParams({ q: text });
  if (type) params.set("type", type);
  return `/search?${params.toString()}`;
}

// API のパス
export function searchApiPath(q: string, type: SearchHitType | null): string {
  const params = new URLSearchParams({ q: q.trim(), limit: "100" });
  if (type) params.set("types", type);
  return `/api/search?${params.toString()}`;
}

// 開く先。取引は明細ページ、ほかはその日の画面
export function hitHref(hit: Pick<SearchHitView, "type" | "id" | "date">): string {
  return hit.type === "transaction" ? `/tx/${encodeURIComponent(hit.id)}` : `/day/${hit.date}`;
}

export interface HitGroup {
  date: string;
  hits: SearchHitView[];
}

// 日付ごとにまとめる(入ってきた順=新しい順を保つ)
export function groupHitsByDate(hits: readonly SearchHitView[]): HitGroup[] {
  const groups: HitGroup[] = [];
  for (const hit of hits) {
    const last = groups[groups.length - 1];
    if (last && last.date === hit.date) last.hits.push(hit);
    else groups.push({ date: hit.date, hits: [hit] });
  }
  return groups;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 2026-10-05 → 2026年10月5日(月)
export function dateHeading(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const w = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日(${w})`;
}
