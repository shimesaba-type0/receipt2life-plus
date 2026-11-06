import { describe, expect, it } from "vitest";
import { movieCountText, movieHeading, ratingStars, seatText } from "../../ui/src/pages/moviesLogic";

describe("映画の画面の部品", () => {
  it("評価の星: 1〜5を塗り、評価がなければ空", () => {
    expect(ratingStars(null)).toBe("");
    expect(ratingStars(0)).toBe("");
    expect(ratingStars(3)).toBe("★★★☆☆");
    expect(ratingStars(5)).toBe("★★★★★");
  });

  it("見出し: 作品名、なければ映画館の名前を添える", () => {
    expect(movieHeading({ title: "ダミー作品", venue: "A映画館" })).toBe("ダミー作品");
    expect(movieHeading({ title: null, venue: "A映画館" })).toBe("(作品名なし)A映画館");
    expect(movieHeading({ title: " ", venue: "A映画館" })).toBe("(作品名なし)A映画館");
  });

  it("座席の文言: スクリーン・座席・席種(ないものは省く)", () => {
    expect(seatText({ screen: "スクリーン5", seat: "F-5", seat_class: "プレミアム" })).toBe("スクリーン5 F-5 (プレミアム)");
    expect(seatText({ screen: null, seat: "ソファ", seat_class: null })).toBe("ソファ");
  });

  it("件数の文言", () => {
    expect(movieCountText(0)).toBe("該当する映画の記録はありません。");
    expect(movieCountText(12)).toBe("12件");
  });
});
