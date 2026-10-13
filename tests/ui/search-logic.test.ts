import { describe, expect, it } from "vitest";
import type { SearchHitView } from "../../src/api/contract";
import { parseRoute } from "../../ui/src/route";
import { dateHeading, groupHitsByDate, hitHref, searchApiPath, searchPageHref } from "../../ui/src/pages/searchLogic";

const hit = (over: Partial<SearchHitView>): SearchHitView => ({ type: "event", id: "e1", date: "2026-10-05", title: "t", detail: null, amount: null, transaction_id: null, ...over });

describe("検索ページの純粋な部分", () => {
  it("ルート: /search?q=&type=", () => {
    expect(parseRoute("/search")).toEqual({ name: "search", q: "", type: null });
    expect(parseRoute("/search", "?q=%E6%98%A0%E7%94%BB&type=seat_record")).toEqual({ name: "search", q: "映画", type: "seat_record" });
    expect(parseRoute("/search", "?q=a&type=bogus")).toEqual({ name: "search", q: "a", type: null });
  });
  it("URL とAPIのパスを作る(空の言葉は /search だけ)", () => {
    expect(searchPageHref("  ", null)).toBe("/search");
    expect(searchPageHref("映画 TOHO", "link")).toBe("/search?q=%E6%98%A0%E7%94%BB+TOHO&type=link");
    expect(searchApiPath("皮膚科", null)).toBe("/api/search?q=%E7%9A%AE%E8%86%9A%E7%A7%91&limit=100");
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
