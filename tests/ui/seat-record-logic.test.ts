import { describe, expect, it } from "vitest";
import type { SeatRecordView } from "../../src/api/contract";
import {
  averageLabel,
  emptySeatForm,
  headLabel,
  placeLabel,
  ratingLabel,
  ratingSpoken,
  screenSuggestions,
  seatFormFromRecord,
  seatRecordSummary,
  toNewSeatRecord,
  toSeatRecordPatch,
  toggleRating,
  venueSuggestions,
} from "../../ui/src/pages/seatRecordLogic";

const record: SeatRecordView = {
  id: "s1",
  date: "2026-10-10",
  venue: "A映画館",
  screen: "スクリーン5",
  seat: "F-5",
  rating: 4,
  note: "見やすい",
  title: null,
  transaction_id: null,
  created_at: "2026-10-10T03:00:00.000Z",
};

describe("評価の表示", () => {
  it("星は色ではなく文字で出す", () => {
    expect(ratingLabel(4)).toBe("★4");
    expect(ratingLabel(null)).toBe("評価なし");
    expect(ratingSpoken(5)).toBe("5段階評価の5");
    expect(ratingSpoken(null)).toBe("評価なし");
    expect(averageLabel(3.5)).toBe("★3.5");
    expect(averageLabel(4)).toBe("★4.0");
    expect(averageLabel(null)).toBe("—");
  });
  it("会場とスクリーンを1行にする", () => {
    expect(placeLabel(record)).toBe("A映画館 スクリーン5");
    expect(placeLabel({ venue: "B劇場", screen: null })).toBe("B劇場");
    expect(seatRecordSummary(record)).toBe("A映画館 スクリーン5 F-5 ★4");
  });
  it("作品名があれば1行目に出し、なければ会場から", () => {
    expect(headLabel(record)).toBe("A映画館 スクリーン5");
    expect(headLabel({ ...record, title: "ダミー作品A" })).toBe("ダミー作品A");
    expect(seatRecordSummary({ ...record, title: "ダミー作品A" })).toBe("ダミー作品A A映画館 スクリーン5 F-5 ★4");
  });
  it("評価をもう一度押すと外れる", () => {
    expect(toggleRating(null, 3)).toBe(3);
    expect(toggleRating(3, 3)).toBeNull();
    expect(toggleRating(3, 5)).toBe(5);
  });
});

describe("候補", () => {
  const summary = [
    { venue: "B劇場", screen: null },
    { venue: "A映画館", screen: "スクリーン10" },
    { venue: "A映画館", screen: "スクリーン2" },
    { venue: "A映画館", screen: "スクリーン2" },
    { venue: "C会館", screen: "ホール" },
  ];
  it("会場名は重複なしで並べる", () => {
    expect(venueSuggestions(summary)).toEqual(["A映画館", "B劇場", "C会館"]);
    expect(venueSuggestions([])).toEqual([]);
  });
  it("スクリーン名は選んだ会場のものを数字の順で、会場が空・未知なら全部", () => {
    expect(screenSuggestions(summary, "A映画館")).toEqual(["スクリーン2", "スクリーン10"]);
    expect(screenSuggestions(summary, " A映画館 ")).toEqual(["スクリーン2", "スクリーン10"]);
    expect(screenSuggestions(summary, "")).toEqual(["ホール", "スクリーン2", "スクリーン10"].sort((a, b) => a.localeCompare(b, "ja", { numeric: true })));
    expect(screenSuggestions(summary, "未知")).toHaveLength(3);
  });
});

describe("フォーム → API の入力", () => {
  it("追加: 前後の空白を除き、空の任意項目は送らない", () => {
    const form = { ...emptySeatForm(), venue: " A映画館 ", seat: " F-5 ", screen: " ", note: "", rating: null };
    expect(toNewSeatRecord("2026-10-10", form)).toEqual({ ok: true, value: { date: "2026-10-10", venue: "A映画館", seat: "F-5" } });
  });
  it("追加: 任意項目も送る", () => {
    const form = { title: " ダミー作品A ", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 2, note: " 前すぎた " };
    expect(toNewSeatRecord("2026-10-10", form)).toEqual({
      ok: true,
      value: { date: "2026-10-10", title: "ダミー作品A", venue: "A映画館", screen: "スクリーン5", seat: "F-5", rating: 2, note: "前すぎた" },
    });
  });
  it("作品名・公演名は100文字まで", () => {
    expect(toNewSeatRecord("2026-10-10", { ...emptySeatForm("A映画館"), seat: "F-5", title: "あ".repeat(100) }).ok).toBe(true);
    expect(toNewSeatRecord("2026-10-10", { ...emptySeatForm("A映画館"), seat: "F-5", title: "あ".repeat(101) })).toEqual({ ok: false, message: "作品名・公演名は100文字以内にしてください。" });
  });
  it("必須(会場・座席)が空ならエラー、上限を超えてもエラー", () => {
    expect(toNewSeatRecord("2026-10-10", { ...emptySeatForm(), seat: "F-5" })).toEqual({ ok: false, message: "会場名を入力してください。" });
    expect(toNewSeatRecord("2026-10-10", { ...emptySeatForm("A映画館") })).toEqual({ ok: false, message: "座席を入力してください。" });
    const tooLong = toNewSeatRecord("2026-10-10", { ...emptySeatForm("A映画館"), seat: "F-5", note: "あ".repeat(201) });
    expect(tooLong.ok).toBe(false);
    expect(toNewSeatRecord("2026-10-10", { ...emptySeatForm("A映画館"), seat: "あ".repeat(51) }).ok).toBe(false);
  });
  it("編集: 空にした任意項目は null で消す", () => {
    const form = { ...seatFormFromRecord(record), screen: "", note: " ", rating: null };
    expect(toSeatRecordPatch(form)).toEqual({ ok: true, value: { title: null, venue: "A映画館", seat: "F-5", screen: null, rating: null, note: null } });
    expect(toSeatRecordPatch({ ...form, title: " ダミー作品A " })).toMatchObject({ ok: true, value: { title: "ダミー作品A" } });
    expect(toSeatRecordPatch(seatFormFromRecord(record))).toEqual({
      ok: true,
      value: { title: null, venue: "A映画館", seat: "F-5", screen: "スクリーン5", rating: 4, note: "見やすい" },
    });
  });
  it("記録からフォームを作る", () => {
    expect(seatFormFromRecord({ ...record, screen: null, rating: null, note: null })).toEqual({ title: "", venue: "A映画館", screen: "", seat: "F-5", rating: null, note: "" });
    expect(seatFormFromRecord({ ...record, title: "ダミー作品A" }).title).toBe("ダミー作品A");
  });
});
