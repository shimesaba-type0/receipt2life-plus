import { describe, expect, it } from "vitest";
import { parseRoute } from "../../ui/src/route";

describe("parseRoute", () => {
  it("ホーム", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("")).toEqual({ name: "home" });
  });
  it("カレンダー(月の指定あり・なし・不正)", () => {
    expect(parseRoute("/calendar")).toEqual({ name: "calendar", month: null });
    expect(parseRoute("/calendar/", "?month=2026-10")).toEqual({ name: "calendar", month: "2026-10" });
    expect(parseRoute("/calendar", "?month=abc")).toEqual({ name: "calendar", month: null });
  });
  it("日の詳細", () => {
    expect(parseRoute("/day/2026-10-11")).toEqual({ name: "day", date: "2026-10-11" });
    expect(parseRoute("/day/2026-1-1")).toEqual({ name: "notfound" });
  });
  it("未知のパスは notfound", () => {
    expect(parseRoute("/nope")).toEqual({ name: "notfound" });
  });
});
