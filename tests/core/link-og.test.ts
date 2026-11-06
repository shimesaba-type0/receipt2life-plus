import { describe, expect, it } from "vitest";
import { fetchPageInfo, isBlockedHost, parsePageInfo } from "../../src/core/link-og";
import { TitleFetchError } from "../../src/core/link-titles";

// ウェブのページの OGP の取得。ページ・ホストはすべてダミー(example.test)

const PAGE = "https://example.test/movie";
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>ページの題 | サイト</title>
<meta property="og:title" content="作品の公式ページ &amp; 予告">
<meta property="og:description" content="  公開日と
上映館の案内  ">
<meta property="og:image" content="/img/og.jpg">
<meta name="description" content="別の説明">
</head><body><p>本文はここ</p><meta property="og:title" content="本文の中の偽物"></body></html>`;

const html = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

describe("parsePageInfo", () => {
  it("og:title・og:description・og:image を優先し、文字参照を戻し、空白をまとめる。画像は絶対URLにする。本文(</head> の後)は読まない", () => {
    expect(parsePageInfo(HTML, PAGE)).toEqual({
      title: "作品の公式ページ & 予告",
      description: "公開日と 上映館の案内",
      thumbnail_url: "https://example.test/img/og.jpg",
    });
  });

  it("og が無ければ、<title> と name=description。画像は無し", () => {
    const info = parsePageInfo('<head><title> 題名 </title><meta name="description" content="説明"></head>', PAGE);
    expect(info).toEqual({ title: "題名", description: "説明", thumbnail_url: null });
  });

  it("画像が https でない・長すぎる・壊れているときは無視する。タグの中身が HTML でも、文字として持つ", () => {
    expect(parsePageInfo('<meta property="og:image" content="http://example.test/a.jpg">', PAGE).thumbnail_url).toBeNull();
    expect(parsePageInfo('<meta property="og:image" content="javascript:alert(1)">', PAGE).thumbnail_url).toBeNull();
    expect(parsePageInfo(`<meta property="og:image" content="https://example.test/${"a".repeat(600)}.jpg">`, PAGE).thumbnail_url).toBeNull();
    const info = parsePageInfo('<meta property="og:title" content="&lt;script&gt;alert(1)&lt;/script&gt;">', PAGE);
    expect(info.title).toBe("<script>alert(1)</script>");
  });

  it("タイトルは200文字、説明文は500文字までに切る", () => {
    const info = parsePageInfo(`<meta property="og:title" content="${"あ".repeat(300)}"><meta property="og:description" content="${"い".repeat(600)}">`, PAGE);
    expect([...info.title!]).toHaveLength(200);
    expect([...info.description!]).toHaveLength(500);
  });
});

describe("isBlockedHost", () => {
  it("IPアドレス直書き・localhost・内部向けの名前・1語だけの名前は取りに行かない。ふつうのドメインは行く", () => {
    for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "[::1]", "::1", "2130706433", "0x7f000001", "intranet", "printer.local", "svc.internal", "a.localhost", "example.test."]) {
      if (h === "example.test.") expect(isBlockedHost(h)).toBe(false);
      else expect(isBlockedHost(h), h).toBe(true);
    }
    expect(isBlockedHost("www.example.com")).toBe(false);
    expect(isBlockedHost("example.co.jp")).toBe(false);
  });
});

describe("fetchPageInfo", () => {
  const reason = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof TitleFetchError ? e.reason : `別のエラー: ${String(e)}`));

  it("HTML の先頭から OGP を取る。リクエストは GET・リダイレクトは手動・クッキーなし", async () => {
    let seen: RequestInit | undefined;
    const info = await fetchPageInfo(PAGE, (async (_u: string, init?: RequestInit) => ((seen = init), html(HTML))) as unknown as typeof fetch);
    expect(info.title).toBe("作品の公式ページ & 予告");
    expect(seen).toMatchObject({ method: "GET", redirect: "manual" });
    expect(JSON.stringify(seen!.headers)).not.toMatch(/cookie|authorization/i);
  });

  it("同じホスト(www の有無だけ違うものを含む)への https の転送だけ追う。別のホスト・http・IP へは追わない", async () => {
    const seq = (target: string) => {
      let n = 0;
      return (async () => (n++ === 0 ? new Response(null, { status: 301, headers: { location: target } }) : html(HTML))) as unknown as typeof fetch;
    };
    expect((await fetchPageInfo(PAGE, seq("https://www.example.test/movie/"))).title).toBe("作品の公式ページ & 予告");
    expect((await fetchPageInfo(PAGE, seq("/moved"))).title).toBe("作品の公式ページ & 予告");
    for (const target of ["https://evil.example/", "http://example.test/movie", "https://127.0.0.1/", "https://example.test:8443/x"]) {
      expect(await reason(fetchPageInfo(PAGE, seq(target))), target).toContain("別のサイトへ転送");
    }
  });

  it("転送が多すぎれば止める", async () => {
    const loop = (async () => new Response(null, { status: 302, headers: { location: "/again" } })) as unknown as typeof fetch;
    expect(await reason(fetchPageInfo(PAGE, loop))).toContain("転送");
  });

  it("https でないURL・取りに行かないホストは、通信せずに断る", async () => {
    let called = false;
    const spy = (async () => ((called = true), html(HTML))) as unknown as typeof fetch;
    expect(await reason(fetchPageInfo("http://example.test/", spy))).toContain("https");
    expect(await reason(fetchPageInfo("https://127.0.0.1/", spy))).toContain("取りに行きません");
    expect(await reason(fetchPageInfo("https://localhost/", spy))).toContain("取りに行きません");
    expect(called).toBe(false);
  });

  it("HTML 以外・エラー応答・何も取れないページは、理由つきで失敗する", async () => {
    expect(await reason(fetchPageInfo(PAGE, (async () => new Response("{}", { headers: { "content-type": "application/json" } })) as unknown as typeof fetch))).toContain("HTML ではありません");
    expect(await reason(fetchPageInfo(PAGE, (async () => new Response("x", { status: 404 })) as unknown as typeof fetch))).toContain("404");
    expect(await reason(fetchPageInfo(PAGE, (async () => html("<html><head></head><body>こんにちは</body></html>")) as unknown as typeof fetch))).toContain("ありませんでした");
  });

  it("大きなページは、先頭の256KBだけ読む(失敗にはしない)。<head> が先頭にあれば取れる", async () => {
    const big = `<head><title>大きなページ</title></head>${"x".repeat(1024 * 1024)}`;
    const info = await fetchPageInfo(PAGE, (async () => html(big)) as unknown as typeof fetch);
    expect(info.title).toBe("大きなページ");
  });

  it("通信の失敗・タイムアウトは、理由つきで失敗する", async () => {
    expect(await reason(fetchPageInfo(PAGE, (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch))).toContain("通信に失敗");
    const timeout = (async () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))) as unknown as typeof fetch;
    expect(await reason(fetchPageInfo(PAGE, timeout))).toContain("3秒");
  });

  it("文字コード: ヘッダーや <meta charset> の Shift_JIS も読める", async () => {
    const sjis = new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]); // 「テスト」(Shift_JIS)
    const body = new Uint8Array([...new TextEncoder().encode('<head><meta charset="shift_jis"><title>'), ...sjis, ...new TextEncoder().encode("</title></head>")]);
    const info = await fetchPageInfo(PAGE, (async () => new Response(body, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch);
    expect(info.title).toBe("テスト");
  });
});
