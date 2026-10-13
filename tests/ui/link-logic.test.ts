import { describe, expect, it } from "vitest";
import type { LinkView } from "../../src/api/contract";
import { isSafeLinkHref, linkDisplayText, linkKindLabel, shortenUrl, tweetIdOf, youtubeThumbnailUrl, youtubeVideoIdOf } from "../../ui/src/pages/dayLogic";

const link = (over: Partial<LinkView>): LinkView => ({
  id: "l1",
  url: "https://x.com/example_user/status/1234567890",
  kind: "x",
  title: null,
  description: null,
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
    expect(linkKindLabel("instagram")).toBe("Instagram");
  });
  it("ウェブはサイトのホスト名(www. なし)を返す", () => {
    expect(linkKindLabel("web", "https://www.example.com/a/b")).toBe("example.com");
    expect(linkKindLabel("web", "https://shop.example.co.jp/")).toBe("shop.example.co.jp");
    expect(linkKindLabel("web")).toBe("ウェブ");
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

describe("Instagram と Xの投稿ID", () => {
  it("種類のラベル", () => {
    expect(linkKindLabel("instagram")).toBe("Instagram");
    expect(linkKindLabel("x")).toBe("X");
    expect(linkKindLabel("youtube")).toBe("YouTube");
    expect(linkKindLabel("instagram")).toBe("Instagram");
  });
  it("ウェブはサイトのホスト名(www. なし)を返す", () => {
    expect(linkKindLabel("web", "https://www.example.com/a/b")).toBe("example.com");
    expect(linkKindLabel("web", "https://shop.example.co.jp/")).toBe("shop.example.co.jp");
    expect(linkKindLabel("web")).toBe("ウェブ");
  });

  it("tweetIdOf: Xの投稿のURLだけ投稿ID(数字)を返す。プロフィール・ほかのサイト・https以外は null", () => {
    expect(tweetIdOf("https://x.com/example_user/status/1234567890")).toBe("1234567890");
    expect(tweetIdOf("https://twitter.com/example_user/status/42/")).toBe("42");
    expect(tweetIdOf("https://mobile.x.com/example_user/status/7")).toBe("7");
    expect(tweetIdOf("https://x.com/example_user")).toBeNull();
    expect(tweetIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(tweetIdOf("https://www.instagram.com/p/ABCde12_-xY/")).toBeNull();
    expect(tweetIdOf("http://x.com/example_user/status/1")).toBeNull();
    expect(tweetIdOf("https://x.com.evil.example/u/status/1")).toBeNull();
    expect(tweetIdOf("not a url")).toBeNull();
  });
});

describe("YouTube のサムネイル", () => {
  const ID = "dQw4w9WgXcQ";
  it("youtubeVideoIdOf: watch・youtu.be・shorts・live から動画のID。再生リストだけ・ほかのサイト・不正な形は null", () => {
    expect(youtubeVideoIdOf(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeVideoIdOf(`https://youtube.com/watch?v=${ID}&t=90`)).toBe(ID);
    expect(youtubeVideoIdOf(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeVideoIdOf(`https://youtu.be/${ID}?t=5`)).toBe(ID);
    expect(youtubeVideoIdOf(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youtubeVideoIdOf(`https://www.youtube.com/live/${ID}/`)).toBe(ID);
    expect(youtubeVideoIdOf("https://www.youtube.com/playlist?list=PLabcdefghijk")).toBeNull();
    expect(youtubeVideoIdOf("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeVideoIdOf(`http://www.youtube.com/watch?v=${ID}`)).toBeNull();
    expect(youtubeVideoIdOf(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
    expect(youtubeVideoIdOf("https://x.com/example_user/status/1")).toBeNull();
    expect(youtubeVideoIdOf("not a url")).toBeNull();
  });

  it("youtubeThumbnailUrl: 動画のIDから決まる i.ytimg.com の画像(取りに行かない)", () => {
    expect(youtubeThumbnailUrl(ID)).toBe(`https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
  });
});
