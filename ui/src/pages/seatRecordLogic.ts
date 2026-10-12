import type { NewSeatRecord, SeatRecordPatch, SeatRecordView, SeatSummaryRow } from "../../../src/api/contract";

// 座席の記録(映画館のスクリーン・座席など)の、画面用の純粋なロジック

export const RATINGS = [1, 2, 3, 4, 5] as const;

// 上限は src/core/seat-records.ts と同じ
export const SEAT_LIMITS = { title: 100, venue: 100, screen: 100, seat: 50, note: 200 } as const;

// 色だけに頼らず、文字で評価を出す。未評価は「評価なし」
export function ratingLabel(rating: number | null | undefined): string {
  return rating ? `★${rating}` : "評価なし";
}

// 読み上げ用(「★4」だけだと読み上げが不明瞭なので)
export function ratingSpoken(rating: number | null | undefined): string {
  return rating ? `5段階評価の${rating}` : "評価なし";
}

// 平均評価の表示(小数1桁。評価がなければ「—」)
export function averageLabel(avg: number | null | undefined): string {
  return avg === null || avg === undefined ? "—" : `★${avg.toFixed(1)}`;
}

// 会場とスクリーンを1行にする(例「A映画館 スクリーン5」)
export function placeLabel(r: Pick<SeatRecordView, "venue" | "screen">): string {
  return r.screen ? `${r.venue} ${r.screen}` : r.venue;
}

// 一覧の行の1行目: 作品名・公演名があればそれ、なければ従来どおり会場(とスクリーン)
export function headLabel(r: Pick<SeatRecordView, "title" | "venue" | "screen">): string {
  return r.title ? r.title : placeLabel(r);
}

// 一覧の行の読み上げ用の説明(作品名があれば先頭に付ける)
export function seatRecordSummary(r: Pick<SeatRecordView, "title" | "venue" | "screen" | "seat" | "rating">): string {
  return `${r.title ? `${r.title} ` : ""}${placeLabel(r)} ${r.seat} ${ratingLabel(r.rating)}`;
}

// 会場名の候補(既存の記録の会場名。重複なし、五十音・文字コード順)
export function venueSuggestions(summary: Pick<SeatSummaryRow, "venue">[]): string[] {
  return [...new Set(summary.map((s) => s.venue))].sort((a, b) => a.localeCompare(b, "ja"));
}

// 会場が決まったら、その会場のスクリーン名の候補。会場が空・未知なら全部
export function screenSuggestions(summary: Pick<SeatSummaryRow, "venue" | "screen">[], venue: string): string[] {
  const v = venue.trim();
  const rows = v === "" ? summary : summary.filter((s) => s.venue === v);
  const source = rows.length > 0 ? rows : summary;
  return [...new Set(source.flatMap((s) => (s.screen ? [s.screen] : [])))].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
}

export interface SeatFormValues {
  title: string;
  venue: string;
  screen: string;
  seat: string;
  rating: number | null;
  note: string;
}

export function emptySeatForm(venue = ""): SeatFormValues {
  return { title: "", venue, screen: "", seat: "", rating: null, note: "" };
}

export function seatFormFromRecord(r: SeatRecordView): SeatFormValues {
  return { title: r.title ?? "", venue: r.venue, screen: r.screen ?? "", seat: r.seat, rating: r.rating, note: r.note ?? "" };
}

// 選んだ評価をもう一度押したら外す(評価は任意)
export function toggleRating(current: number | null, picked: number): number | null {
  return current === picked ? null : picked;
}

export type FormResult<T> = { ok: true; value: T } | { ok: false; message: string };

function checkRequired(f: SeatFormValues): string | null {
  const title = f.title.trim();
  const venue = f.venue.trim();
  const screen = f.screen.trim();
  const seat = f.seat.trim();
  const note = f.note.trim();
  if (venue === "") return "会場名を入力してください。";
  if (seat === "") return "座席を入力してください。";
  if (title.length > SEAT_LIMITS.title) return `作品名・公演名は${SEAT_LIMITS.title}文字以内にしてください。`;
  if (venue.length > SEAT_LIMITS.venue) return `会場名は${SEAT_LIMITS.venue}文字以内にしてください。`;
  if (screen.length > SEAT_LIMITS.screen) return `スクリーン名は${SEAT_LIMITS.screen}文字以内にしてください。`;
  if (seat.length > SEAT_LIMITS.seat) return `座席は${SEAT_LIMITS.seat}文字以内にしてください。`;
  if (note.length > SEAT_LIMITS.note) return `一言は${SEAT_LIMITS.note}文字以内にしてください。`;
  return null;
}

// 追加フォーム → API の入力。空の任意項目は送らない
export function toNewSeatRecord(date: string, f: SeatFormValues): FormResult<NewSeatRecord> {
  const error = checkRequired(f);
  if (error) return { ok: false, message: error };
  const value: NewSeatRecord = { date, venue: f.venue.trim(), seat: f.seat.trim() };
  if (f.title.trim() !== "") value.title = f.title.trim();
  if (f.screen.trim() !== "") value.screen = f.screen.trim();
  if (f.rating !== null) value.rating = f.rating;
  if (f.note.trim() !== "") value.note = f.note.trim();
  return { ok: true, value };
}

// 編集フォーム → API の入力。空にした任意項目は null で消す
export function toSeatRecordPatch(f: SeatFormValues): FormResult<SeatRecordPatch> {
  const error = checkRequired(f);
  if (error) return { ok: false, message: error };
  return {
    ok: true,
    value: {
      title: f.title.trim() === "" ? null : f.title.trim(),
      venue: f.venue.trim(),
      seat: f.seat.trim(),
      screen: f.screen.trim() === "" ? null : f.screen.trim(),
      rating: f.rating,
      note: f.note.trim() === "" ? null : f.note.trim(),
    },
  };
}
