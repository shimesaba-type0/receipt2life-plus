import { describe, expect, it } from "vitest";
import type { SearchHitView } from "../../src/api/contract";
import { parseRoute } from "../../ui/src/route";
import { chipLabelFor, dateHeading, groupHitsByDate, hitHref, rangeLabel, sameSearch, searchApiPath, searchPageCount, searchPageHref } from "../../ui/src/pages/searchLogic";

const hit = (over: Partial<SearchHitView>): SearchHitView => ({ type: "event", id: "e1", date: "2026-10-05", title: "t", detail: null, amount: null, transaction_id: null, ...over });

describe("検索ページの純粋な部分", () => {
  it("ルート: /search?q=&type=", () => {
    expect(parseRoute("/search")).toEqual({ name: "search", q: "", type: null, page: 1 });
    expect(parseRoute("/search", "?q=%E6%98%A0%E7%94%BB&type=seat_record&page=3")).toEqual({ name: "search", q: "映画", type: "seat_record", page: 3 });
    expect(parseRoute("/search", "?q=a&type=bogus&page=0")).toEqual({ name: "search", q: "a", type: null, page: 1 });
  });
  it("URL とAPIのパスを作る(空の言葉は /search だけ)", () => {
    expect(searchPageHref("  ", null)).toBe("/search");
    // 言葉が空でも、種類があればその種類の一覧
    expect(searchPageHref("", "seat_record")).toBe("/search?type=seat_record");
    expect(searchApiPath("", "seat_record")).toBe("/api/search?limit=30&types=seat_record");
    expect(searchPageHref("映画 TOHO", "link")).toBe("/search?q=%E6%98%A0%E7%94%BB+TOHO&type=link");
    expect(searchApiPath("皮膚科", null)).toBe("/api/search?limit=30&q=%E7%9A%AE%E8%86%9A%E7%A7%91");
    expect(searchApiPath("a", null, 3)).toBe("/api/search?limit=30&q=a&offset=60");
    expect(searchPageHref("a", null, 2)).toBe("/search?q=a&page=2");
    expect(searchPageHref("a", null, 1)).toBe("/search?q=a");
    expect(rangeLabel(30, 30, 75)).toBe("31〜60件目(全75件)");
    expect(searchApiPath("a", "photo")).toContain("types=photo");
  });
  it("開く先: 取引は明細、ほかはその日", () => {
    expect(hitHref(hit({ type: "transaction", id: "a b" }))).toBe("/tx/a%20b");
    expect(hitHref(hit({ type: "event" }))).toBe("/day/2026-10-05");
  });
  it("日付ごとにまとめ、見出しは曜日つき", () => {
    const groups = groupHitsByDate([hit({ id: "1" }), hit({ id: "2" }), hit({ id: "3", date: "2026-09-01" })]);
    expect(groups.map((g) => [g.date, g.hits.length])).toEqual([["2026-10-05", 2], ["2026-09-01", 1]]);
    expect(dateHeading("2026-10-05")).toBe("2026年10月5日(月)");
    expect(dateHeading("bad")).toBe("bad");
  });
});

describe("検索のページ数", () => {
  it("30件ごと。0件でも1ページ", () => {
    expect(searchPageCount(0)).toBe(1);
    expect(searchPageCount(30)).toBe(1);
    expect(searchPageCount(31)).toBe(2);
    expect(searchPageCount(95)).toBe(4);
  });
});

describe("よく使う検索のチップ", () => {
  it("いまの検索と同じか(言葉の前後の空白は無視、対象は null と省略が同じ)", () => {
    expect(sameSearch({ q: "映画", type: null }, " 映画 ", null)).toBe(true);
    expect(sameSearch({ q: "映画", type: "event" }, "映画", null)).toBe(false);
    expect(sameSearch({ q: "", type: "link" }, "", "link")).toBe(true);
  });
  it("名前の候補は、言葉、なければ対象の名前(20文字まで)", () => {
    expect(chipLabelFor("皮膚科", null)).toBe("皮膚科");
    expect(chipLabelFor("", "seat_record")).not.toBe("");
    expect(chipLabelFor("あ".repeat(30), null)).toHaveLength(20);
    expect(chipLabelFor("", null)).toBe("");
  });
});
