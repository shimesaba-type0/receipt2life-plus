import { describe, expect, it } from "vitest";
import { addLink, refreshLinkTitle } from "../../src/core/links";
import { TitleFetchError, makeTitleFetcher, oembedEndpoint, titleFromX, titleFromYouTube, type TitleFetcher } from "../../src/core/link-titles";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const X_POST = "https://x.com/example_user/status/1234567890";

const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("oEmbed の応答からタイトルを作る(ダミーの応答)", () => {
  it("YouTube: title。空白をまとめ、空や文字以外は null、200文字で切る", () => {
    expect(titleFromYouTube({ title: "  ダミー  予告編\n(公式)  ", author_name: "x" })).toBe("ダミー 予告編 (公式)");
    expect(titleFromYouTube({ title: "" })).toBeNull();
    expect(titleFromYouTube({ title: 5 })).toBeNull();
    expect(titleFromYouTube(null)).toBeNull();
    const long = titleFromYouTube({ title: "あ".repeat(300) })!;
    expect([...long]).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
  });

  it("X: 「投稿者名: 本文」。<p> の中だけを取り、タグを消し、文字参照を戻す", () => {
    const html = '<blockquote class="twitter-tweet"><p lang="ja" dir="ltr">ダミーの投稿 &amp; テスト<br>2行目 <a href="https://t.co/x">t.co/x</a></p>&mdash; ダミー (@example_user) <a href="https://x.com/example_user/status/1">October 11, 2026</a></blockquote>\n';
    expect(titleFromX({ author_name: "ダミー", html })).toBe("ダミー: ダミーの投稿 & テスト 2行目 t.co/x");
    expect(titleFromX({ html })).toBe("ダミーの投稿 & テスト 2行目 t.co/x");
    expect(titleFromX({ author_name: "A", html: "<blockquote></blockquote>" })).toBeNull();
    expect(titleFromX({ author_name: "A" })).toBeNull();
    expect(titleFromX({ author_name: "A", html: "<p>&#x3042;&#12354;&unknown;</p>" })).toBe("A: ああ&unknown;");
  });
});

describe("makeTitleFetcher(通信は差し替え)", () => {
  it("取りに行く先は、YouTube と X の oEmbed の固定のホストだけ。リンクのURLは値として渡す", async () => {
    const urls: string[] = [];
    const f = makeTitleFetcher((async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return jsonResponse({ title: "ダミー動画" });
    }) as typeof fetch);
    expect(await f("youtube", YT)).toBe("ダミー動画");
    expect(new URL(urls[0]!).host).toBe("www.youtube.com");
    expect(new URL(urls[0]!).searchParams.get("url")).toBe(YT);
    expect(new URL(oembedEndpoint("x", X_POST)).host).toBe("publish.twitter.com");
  });

  it("Instagram は取りに行かない(通信しない)", async () => {
    let called = false;
    const f = makeTitleFetcher((async () => ((called = true), jsonResponse({ title: "x" }))) as typeof fetch);
    expect(await f("instagram", "https://www.instagram.com/p/ABCde12_-xY/")).toBeNull();
    expect(called).toBe(false);
  });

  const reasonOf = async (f: TitleFetcher, kind: "youtube" | "x" = "youtube") => {
    try {
      await f(kind, kind === "youtube" ? YT : X_POST);
      return null;
    } catch (e) {
      return e instanceof TitleFetchError ? e.reason : `想定外: ${String(e)}`;
    }
  };

  it("失敗は、理由つきの TitleFetchError(404・401・429・通信エラー・壊れたJSON・大きすぎる応答・タイトルなし)", async () => {
    expect(await reasonOf(makeTitleFetcher((async () => new Response("no", { status: 404 })) as typeof fetch))).toContain("404");
    expect(await reasonOf(makeTitleFetcher((async () => new Response("no", { status: 401 })) as typeof fetch))).toContain("埋め込みが許可されていない");
    expect(await reasonOf(makeTitleFetcher((async () => new Response("no", { status: 429 })) as typeof fetch), "x")).toContain("X");
    expect(await reasonOf(makeTitleFetcher((async () => { throw new Error("net"); }) as typeof fetch))).toContain("通信に失敗");
    expect(await reasonOf(makeTitleFetcher((async () => new Response("{", { status: 200 })) as typeof fetch))).toContain("読み取れません");
    expect(await reasonOf(makeTitleFetcher((async () => new Response("x".repeat(70 * 1024), { status: 200 })) as typeof fetch))).toContain("大きすぎ");
    expect(await reasonOf(makeTitleFetcher((async () => jsonResponse({ title: "" })) as typeof fetch))).toContain("タイトルがありません");
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(await reasonOf(makeTitleFetcher((async () => { throw timeout; }) as typeof fetch))).toContain("3秒");
  });

  it("リダイレクトは、固定の公式ホスト(publish.x.com など)にだけ追う。それ以外へは追わずに失敗", async () => {
    const hosts: string[] = [];
    const moved = makeTitleFetcher((async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      hosts.push(u.hostname);
      if (u.hostname === "publish.twitter.com") return new Response(null, { status: 301, headers: { location: `https://publish.x.com${u.pathname}${u.search}` } });
      return jsonResponse({ author_name: "ダミー", html: "<blockquote><p>本文</p></blockquote>" });
    }) as typeof fetch);
    expect(await moved("x", X_POST)).toBe("ダミー: 本文");
    expect(hosts).toEqual(["publish.twitter.com", "publish.x.com"]);

    const evil = makeTitleFetcher((async () => new Response(null, { status: 302, headers: { location: "https://evil.example/oembed" } })) as typeof fetch);
    expect(await reasonOf(evil)).toContain("想定外の場所");
    const http = makeTitleFetcher((async () => new Response(null, { status: 302, headers: { location: "http://www.youtube.com/oembed" } })) as typeof fetch);
    expect(await reasonOf(http)).toContain("想定外の場所");
    const loop = makeTitleFetcher((async () => new Response(null, { status: 302, headers: { location: "https://www.youtube.com/oembed" } })) as typeof fetch);
    expect(await reasonOf(loop)).toContain("転送が多すぎ");
  });
});

describe("addLink と refreshLinkTitle", () => {
  const ok: TitleFetcher = async () => "取得したタイトル";
  const fail: TitleFetcher = async () => {
    throw new TitleFetchError("YouTubeが 404 を返しました");
  };
  const boom: TitleFetcher = async () => {
    throw new Error("x");
  };

  it("表題が無いと取りに行って付ける。表題があれば取りに行かない。取れなくても登録は成功する", async () => {
    const withFetched = await addLink(db(), { url: YT, date: "2026-10-10" }, { now: NOW, fetchTitle: ok });
    expect(withFetched).toMatchObject({ ok: true, link: { title: "取得したタイトル" } });
    let called = false;
    const given = await addLink(db(), { url: X_POST, title: "自分で付けた", date: "2026-10-10" }, { now: NOW, fetchTitle: async () => ((called = true), "x") });
    expect(given).toMatchObject({ ok: true, link: { title: "自分で付けた" } });
    expect(called).toBe(false);
    const failed = await addLink(db(), { url: "https://youtu.be/abcdefghijk", date: "2026-10-10" }, { now: NOW, fetchTitle: fail });
    expect(failed).toMatchObject({ ok: true, link: { title: null } });
    const thrown = await addLink(db(), { url: "https://youtu.be/bbcdefghijk", date: "2026-10-10" }, { now: NOW, fetchTitle: boom });
    expect(thrown).toMatchObject({ ok: true, link: { title: null } });
    // 取得の仕組みが無ければ(テスト・インポート)取りに行かない
    const none = await addLink(db(), { url: "https://youtu.be/cbcdefghijk", date: "2026-10-10" }, { now: NOW });
    expect(none).toMatchObject({ ok: true, link: { title: null } });
  });

  it("refreshLinkTitle: Instagram は取得できないと案内するエラー(取得の関数は呼ばない)", async () => {
    const added = await addLink(db(), { url: "https://www.instagram.com/p/ABCde12_-xY/", date: "2026-10-10" }, { now: NOW });
    if (!added.ok) throw new Error("add");
    let called = false;
    const r = await refreshLinkTitle(db(), { id: added.link.id }, async () => ((called = true), "x"));
    expect(r).toMatchObject({ ok: false, errors: [{ field: "title", message: expect.stringContaining("Instagram") }] });
    expect(called).toBe(false);
  });

  it("refreshLinkTitle: タイトルを付け直す。取れなければエラーでタイトルは変えない。存在しない id もエラー", async () => {
    const added = await addLink(db(), { url: YT, date: "2026-10-10" }, { now: NOW });
    if (!added.ok) throw new Error("add");
    const id = added.link.id;
    const failed = await refreshLinkTitle(db(), { id }, fail);
    expect(failed).toMatchObject({ ok: false, errors: [{ field: "title", message: expect.stringContaining("YouTubeが 404 を返しました") }] });
    expect(await refreshLinkTitle(db(), { id }, ok)).toMatchObject({ ok: true, link: { title: "取得したタイトル" } });
    expect(await refreshLinkTitle(db(), { id }, fail)).toMatchObject({ ok: false });
    const row = await db().prepare("SELECT title FROM links WHERE id = ?").bind(id).first<{ title: string }>();
    expect(row?.title).toBe("取得したタイトル");
    expect(await refreshLinkTitle(db(), { id: "nope" }, ok)).toMatchObject({ ok: false, errors: [{ field: "id" }] });
  });
});
