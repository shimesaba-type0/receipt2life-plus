import { describe, expect, it } from "vitest";
import type { LinkView } from "../../src/api/contract";
import { isSafeLinkHref, linkDisplayText, linkKindLabel, shortenUrl } from "../../ui/src/pages/dayLogic";

const link = (over: Partial<LinkView>): LinkView => ({
  id: "l1",
  url: "https://x.com/example_user/status/1234567890",
  kind: "x",
  title: null,
  date: "2026-10-11",
  transaction_id: null,
  event_id: null,
  created_at: "2026-10-11T00:00:00Z",
  ...over,
});

describe("linkKindLabel", () => {
  it("種類の表示名を返す", () => {
    expect(linkKindLabel("x")).toBe("X");
    expect(linkKindLabel("youtube")).toBe("YouTube");
  });
});

describe("shortenUrl", () => {
  it("https:// と www. を外し、ホスト+パスにする", () => {
    expect(shortenUrl("https://x.com/example_user/status/1234567890")).toBe("x.com/example_user/status/1234567890");
    expect(shortenUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube.com/watch?v=dQw4w9WgXcQ");
    expect(shortenUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("youtu.be/dQw4w9WgXcQ");
  });
  it("末尾のスラッシュは落とす", () => {
    expect(shortenUrl("https://x.com/example_user/")).toBe("x.com/example_user");
  });
  it("長いときは最大文字数に収めて「…」を付ける", () => {
    const out = shortenUrl("https://www.youtube.com/playlist?list=PLaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 30);
    expect(out.length).toBe(30);
    expect(out.endsWith("…")).toBe(true);
  });
  it("URLとして読めなければそのまま(長ければ切る)", () => {
    expect(shortenUrl("not a url")).toBe("not a url");
    expect(shortenUrl("a".repeat(50), 10)).toBe("aaaaaaaaa…");
  });
});

describe("linkDisplayText", () => {
  it("タイトルがあればそれを使う", () => {
    expect(linkDisplayText(link({ title: "  サンプルの投稿  " }))).toBe("サンプルの投稿");
  });
  it("タイトルが無い・空白だけならURLの短縮", () => {
    expect(linkDisplayText(link({ title: null }))).toBe("x.com/example_user/status/1234567890");
    expect(linkDisplayText(link({ title: "   " }))).toBe("x.com/example_user/status/1234567890");
  });
});

describe("isSafeLinkHref", () => {
  it("https だけ許す", () => {
    expect(isSafeLinkHref("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isSafeLinkHref("http://youtu.be/dQw4w9WgXcQ")).toBe(false);
    expect(isSafeLinkHref("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkHref("")).toBe(false);
  });
});
