import { describe, expect, it } from "vitest";
import { addEvent, deleteEvent } from "../../src/core/events";
import { addLink, deleteLink, listLinks, parseLinkUrl, updateLink } from "../../src/core/links";
import { addTransactions, deleteTransaction } from "../../src/core/transactions";
import { NOW, testEnv } from "../helpers";

const db = () => testEnv().DB;
const X_POST = "https://x.com/example_user/status/1234567890";
const YT = "https://youtu.be/dQw4w9WgXcQ";

describe("parseLinkUrl: 受け付けるURL", () => {
  it.each([
    [X_POST, "x", X_POST],
    ["https://twitter.com/example_user/status/1234567890", "x", "https://twitter.com/example_user/status/1234567890"],
    ["https://mobile.twitter.com/example_user/status/1234567890/", "x", "https://mobile.twitter.com/example_user/status/1234567890"],
    ["https://WWW.X.COM/example_user", "x", "https://www.x.com/example_user"],
    ["https://x.com:443/example_user/status/1", "x", "https://x.com/example_user/status/1"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "https://music.youtube.com/watch?v=dQw4w9WgXcQ"],
    [YT, "youtube", YT],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "youtube", "https://www.youtube.com/live/dQw4w9WgXcQ"],
    ["https://www.youtube.com/playlist?list=PLabcdefghij_-123", "youtube", "https://www.youtube.com/playlist?list=PLabcdefghij_-123"],
  ])("%s", (input, kind, url) => {
    expect(parseLinkUrl(input)).toEqual({ ok: true, url, kind });
  });
});

describe("parseLinkUrl: 正規化", () => {
  it("フラグメントを消す", () => {
    expect(parseLinkUrl(`${X_POST}#top`)).toMatchObject({ url: X_POST });
    expect(parseLinkUrl(`${YT}#x`)).toMatchObject({ url: YT });
  });

  it("追跡用のクエリを消す: Xは s / t も消す", () => {
    expect(parseLinkUrl(`${X_POST}?s=20&t=abc&utm_source=a&utm_medium=b&fbclid=z&si=q`)).toMatchObject({ url: X_POST });
  });

  it("YouTubeは t(開始位置)を残し、si / feature / utm_* / fbclid を消す", () => {
    expect(parseLinkUrl("https://youtu.be/dQw4w9WgXcQ?si=abc&t=90&utm_campaign=x&fbclid=y")).toMatchObject({
      url: "https://youtu.be/dQw4w9WgXcQ?t=90",
    });
    expect(parseLinkUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&t=1m30s")).toMatchObject({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s",
    });
  });

  it("クエリの順が違っても同じURLになる(Xのその他の項目は並べ替える)", () => {
    const a = parseLinkUrl("https://x.com/example_user?b=2&a=1");
    const b = parseLinkUrl("https://x.com/example_user?a=1&b=2");
    expect(a).toEqual(b);
  });

  it("ホストは小文字にするが、x.com / youtube.com には寄せない", () => {
    expect(parseLinkUrl("https://Mobile.X.com/example_user/status/9")).toMatchObject({ url: "https://mobile.x.com/example_user/status/9" });
  });
});

describe("parseLinkUrl: 拒否するURL", () => {
  const reject = (input: string, includes?: string) => {
    const r = parseLinkUrl(input);
    expect(r.ok, input).toBe(false);
    if (!r.ok && includes) expect(r.message).toContain(includes);
    // どのエラーにも、対応サイトと直し方が入る
    if (!r.ok) expect(r.message).toContain("対応しているのは");
  };

  it("偽装ホスト(完全一致でないもの)は、X・YouTube とは扱わず ウェブ のリンクにする", () => {
    for (const url of [
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://x.com.evil.example/example_user/status/1",
      "https://evil.com/?u=youtube.com",
      "https://evilyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://notx.com/example_user/status/1",
      "https://sub.x.com/example_user/status/1",
      "https://youtu.be.evil.example/dQw4w9WgXcQ",
      "https://evil.com\\@x.com/example_user/status/1",
      "https://x.com%2eevil.example/example_user/status/1",
    ]) {
      expect(parseLinkUrl(url), url).toMatchObject({ ok: true, kind: "web" });
    }
    reject("https://x.com./example_user/status/1", "公開されたドメイン名");
  });

  it("https 以外(javascript: / http: / data: など)", () => {
    reject("javascript:alert(1)", "https");
    reject("javascript://x.com/%0aalert(1)");
    reject("http://x.com/example_user/status/1", "https");
    reject("ftp://x.com/example_user/status/1", "https");
    reject("data:text/html,x");
    reject("//x.com/example_user/status/1");
    reject("x.com/example_user/status/1");
  });

  it("ポートは省略か 443 のみ", () => {
    reject("https://x.com:8443/example_user/status/1", "ポート");
    reject("https://youtu.be:80/dQw4w9WgXcQ", "ポート");
  });

  it("userinfo を含むURL", () => {
    reject("https://user:pass@x.com/example_user/status/1", "user:pass@");
    reject("https://user@youtu.be/dQw4w9WgXcQ", "user:pass@");
    reject("https://x.com@evil.example/example_user/status/1");
  });

  it("空白・制御文字・ASCII以外", () => {
    reject("");
    reject("   ");
    reject(`${X_POST} extra`);
    reject(`${X_POST}\n`.replace(/\n$/, "\nx"));
    reject("https://ｘ.com/example_user/status/1");
  });

  it("長すぎるURL(2048文字超)", () => {
    reject(`https://x.com/example_user/status/1?${"a=b&".repeat(600)}`, "長すぎ");
  });

  it("Xのパスの形", () => {
    reject("https://x.com/example_user/status/abc");
    reject("https://x.com/example_user/status/");
    reject("https://x.com/example_user/likes");
    reject("https://x.com/example_user/status/1/photo/1");
    reject("https://x.com/");
    reject("https://x.com/home", "プロフィール");
    reject("https://x.com/search?q=a");
    reject("https://x.com/this_name_is_too_long/status/1");
    reject("https://x.com/user%20name/status/1");
  });

  it("YouTubeのパスと ID の形", () => {
    reject("https://www.youtube.com/");
    reject("https://www.youtube.com/watch");
    reject("https://www.youtube.com/watch?v=short");
    reject("https://www.youtube.com/watch?v=dQw4w9WgXc!");
    reject("https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa");
    reject("https://www.youtube.com/watch?v=dQw4w9WgXcQtoolong");
    reject("https://www.youtube.com/channel/UC1234567890123456789012");
    reject("https://www.youtube.com/shorts/short");
    reject("https://www.youtube.com/live/");
    reject("https://www.youtube.com/playlist");
    reject("https://www.youtube.com/playlist?list=a");
    reject("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=abc");
    reject("https://youtu.be/");
    reject("https://youtu.be/dQw4w9WgXcQ/extra");
    reject("https://youtu.be/dQw4w9WgXc");
  });
});

async function seedTx(date = "2026-10-10"): Promise<string> {
  const r = await addTransactions(db(), { transactions: [{ date, amount: 900, merchant: "A店", category: "食費" }] }, { now: NOW });
  if (!r.ok) throw new Error("seed");
  return r.registered[0]!.id;
}
async function seedEvent(start: string, end?: string): Promise<string> {
  const r = await addEvent(db(), { title: "旅行", start_date: start, ...(end ? { end_date: end } : {}) }, { now: NOW });
  if (!r.ok) throw new Error("seed");
  return r.event.id;
}
const add = (input: unknown) => addLink(db(), input, { now: NOW });

describe("addLink", () => {
  it("日付に付ける: 正規化して保存し、kind と作成日時が入る", async () => {
    const r = await add({ url: `${X_POST}?utm_source=a#frag`, title: "感想", date: "2026-10-10" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(false);
    expect(r.link).toMatchObject({ url: X_POST, kind: "x", title: "感想", date: "2026-10-10", transaction_id: null, event_id: null, created_at: NOW.toISOString() });
    expect(r.message).toContain("リンクを登録しました");
    const row = await db().prepare("SELECT url, kind FROM links WHERE id = ?").bind(r.link.id).first();
    expect(row).toEqual({ url: X_POST, kind: "x" });
  });

  it("取引・出来事に付ける", async () => {
    const tx = await seedTx();
    const ev = await seedEvent("2026-10-03", "2026-10-05");
    expect((await add({ url: YT, transaction_id: tx })).ok).toBe(true);
    expect((await add({ url: YT, event_id: ev })).ok).toBe(true);
  });

  it("紐づけ先が1つも無ければエラー", async () => {
    const r = await add({ url: X_POST });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]!.message).toContain("1つ以上");
  });

  it("不正なURL(http・内部ホスト)は、直し方つきのエラー(field は url)", async () => {
    const r = await add({ url: "https://localhost/a", date: "2026-10-10" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]!.field).toBe("url");
    expect(r.errors[0]!.message).toContain("x.com");
    expect(r.errors[0]!.message).toContain("youtu.be");
  });

  it("存在しない取引・出来事はエラー", async () => {
    const r = await add({ url: X_POST, transaction_id: "nope", event_id: "nope2" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.field).sort()).toEqual(["event_id", "transaction_id"]);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>())!.n).toBe(0);
  });

  it("未知の項目・不正な日付・長すぎるタイトルはエラー", async () => {
    expect((await add({ url: X_POST, date: "2026-10-10", kind: "x" })).ok).toBe(false);
    expect((await add({ url: X_POST, date: "2026-13-40" })).ok).toBe(false);
    expect((await add({ url: X_POST, date: "2026-10-10", title: "あ".repeat(201) })).ok).toBe(false);
  });

  it("重複: 同じ紐づけ先に同じ正規化URLなら登録せず既存idを返す", async () => {
    const first = await add({ url: X_POST, date: "2026-10-10" });
    const second = await add({ url: `${X_POST}?s=20&utm_source=x`, date: "2026-10-10" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.link.id).toBe(first.link.id);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>())!.n).toBe(1);
  });

  it("重複: 紐づけ先が違えば別のリンク", async () => {
    const tx = await seedTx();
    const a = await add({ url: X_POST, date: "2026-10-10" });
    const b = await add({ url: X_POST, date: "2026-10-11" });
    const c = await add({ url: X_POST, transaction_id: tx });
    if (!a.ok || !b.ok || !c.ok) throw new Error("add");
    expect(new Set([a.link.id, b.link.id, c.link.id]).size).toBe(3);
    expect([a.duplicate, b.duplicate, c.duplicate]).toEqual([false, false, false]);
  });
});

describe("updateLink / deleteLink", () => {
  it("title だけ変えられる(null で消去)。URLなどは変わらない", async () => {
    const a = await add({ url: YT, title: "旧", date: "2026-10-10" });
    if (!a.ok) throw new Error("add");
    const u = await updateLink(db(), { id: a.link.id, title: "新" });
    expect(u.ok && u.link).toMatchObject({ title: "新", url: YT, date: "2026-10-10" });
    const cleared = await updateLink(db(), { id: a.link.id, title: null });
    expect(cleared.ok && cleared.link.title).toBeNull();
    expect((await db().prepare("SELECT title FROM links WHERE id = ?").bind(a.link.id).first())!.title).toBeNull();
  });

  it("url などの変更や存在しない id はエラー", async () => {
    const a = await add({ url: YT, date: "2026-10-10" });
    if (!a.ok) throw new Error("add");
    expect((await updateLink(db(), { id: a.link.id, title: "x", url: X_POST })).ok).toBe(false);
    expect((await updateLink(db(), { id: a.link.id })).ok).toBe(false);
    const nf = await updateLink(db(), { id: "none", title: "x" });
    expect(!nf.ok && nf.errors[0]).toMatchObject({ field: "id" });
    expect(!nf.ok && nf.errors[0]!.message).toMatch(/という.+はありません/);
  });

  it("削除する。存在しない id はエラー", async () => {
    const a = await add({ url: YT, date: "2026-10-10" });
    if (!a.ok) throw new Error("add");
    const d = await deleteLink(db(), { id: a.link.id });
    expect(d.ok && d.deleted.id).toBe(a.link.id);
    expect((await deleteLink(db(), { id: a.link.id })).ok).toBe(false);
  });
});

describe("listLinks", () => {
  it("date は、その日・その日の取引・重なる出来事の和集合(重複なし)", async () => {
    const txDay = await seedTx("2026-10-10");
    const txOther = await seedTx("2026-10-01");
    const evIn = await seedEvent("2026-10-09", "2026-10-12");
    const evOut = await seedEvent("2026-10-15");
    const direct = await add({ url: "https://youtu.be/aaaaaaaaaaa", date: "2026-10-10" });
    const viaTx = await add({ url: "https://youtu.be/bbbbbbbbbbb", transaction_id: txDay });
    const viaEvent = await add({ url: "https://youtu.be/ccccccccccc", event_id: evIn });
    // 日付と取引の両方がその日に当たっても1件
    const both = await add({ url: "https://youtu.be/ddddddddddd", date: "2026-10-10", transaction_id: txDay });
    await add({ url: "https://youtu.be/eeeeeeeeeee", transaction_id: txOther });
    await add({ url: "https://youtu.be/fffffffffff", event_id: evOut });
    await add({ url: "https://youtu.be/ggggggggggg", date: "2026-10-11" });
    if (!direct.ok || !viaTx.ok || !viaEvent.ok || !both.ok) throw new Error("add");

    const r = await listLinks(db(), { date: "2026-10-10" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count).toBe(4);
    expect(r.links.map((l) => l.id).sort()).toEqual([direct.link.id, viaTx.link.id, viaEvent.link.id, both.link.id].sort());
  });

  it("transaction_id / event_id は、その紐づけ先だけ。複数指定は和集合", async () => {
    const tx = await seedTx();
    const ev = await seedEvent("2026-10-03");
    const a = await add({ url: YT, transaction_id: tx });
    const b = await add({ url: X_POST, event_id: ev });
    if (!a.ok || !b.ok) throw new Error("add");
    expect(await listLinks(db(), { transaction_id: tx })).toMatchObject({ ok: true, count: 1 });
    expect(await listLinks(db(), { event_id: ev })).toMatchObject({ ok: true, count: 1 });
    expect(await listLinks(db(), { transaction_id: tx, event_id: ev })).toMatchObject({ ok: true, count: 2 });
  });

  it("条件なし・存在しない id はエラー、該当なしは空", async () => {
    expect((await listLinks(db(), {})).ok).toBe(false);
    expect((await listLinks(db(), { transaction_id: "nope" })).ok).toBe(false);
    expect(await listLinks(db(), { date: "2026-01-01" })).toMatchObject({ ok: true, count: 0, message: "該当するリンクはありません" });
  });
});

describe("取引・出来事の削除とリンク", () => {
  it("リンクがあっても拒否せず、リンクもいっしょに消える", async () => {
    const tx = await seedTx();
    const ev = await seedEvent("2026-10-03");
    const keep = await add({ url: YT, date: "2026-10-10" });
    await add({ url: X_POST, transaction_id: tx });
    await add({ url: "https://youtu.be/aaaaaaaaaaa", event_id: ev });
    // 日付も持つリンクは、紐づけ先の取引が消えるとリンクごと消える
    await add({ url: "https://youtu.be/bbbbbbbbbbb", date: "2026-10-10", transaction_id: tx });

    expect((await deleteTransaction(db(), { id: tx })).ok).toBe(true);
    expect((await deleteEvent(db(), { id: ev })).ok).toBe(true);
    const rows = await db().prepare("SELECT id FROM links").all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual([keep.ok ? keep.link.id : ""]);
  });
});

describe("parseLinkUrl: Instagram", () => {
  const IG = "https://www.instagram.com/p/ABCde12_-xY/";
  it.each([
    ["https://www.instagram.com/p/ABCde12_-xY/", IG],
    ["https://instagram.com/p/ABCde12_-xY", "https://instagram.com/p/ABCde12_-xY/"],
    ["https://www.instagram.com/reel/ABCde12_-xY/?igsh=abc&utm_source=qr#x", "https://www.instagram.com/reel/ABCde12_-xY/"],
    ["https://www.instagram.com/example.user/p/ABCde12_-xY/?img_index=2", IG.replace("/p/", "/example.user/p/")],
    ["https://www.instagram.com/tv/ABCde12_-xY/", "https://www.instagram.com/tv/ABCde12_-xY/"],
    ["https://www.instagram.com/example.user/", "https://www.instagram.com/example.user/"],
    ["https://www.instagram.com/example_user?hl=ja", "https://www.instagram.com/example_user/"],
  ])("%s を受け付けて正規化する", (input, url) => {
    expect(parseLinkUrl(input)).toEqual({ ok: true, url, kind: "instagram" });
  });

  it.each([
    "http://www.instagram.com/p/ABCde12_-xY/",
    "https://www.instagram.com/stories/example/123/",
    "https://www.instagram.com/explore/",
    "https://www.instagram.com/accounts/login/",
    "https://www.instagram.com/p/",
    "https://www.instagram.com/p/a/",
    "https://www.instagram.com/p/ABCde12_-xY/extra",
    "https://www.instagram.com/bad user/",
    "https://user:pw@www.instagram.com/p/ABCde12_-xY/",
    "https://www.instagram.com:8443/p/ABCde12_-xY/",
  ])("%s は受け付けない", (input) => {
    expect(parseLinkUrl(input).ok).toBe(false);
  });

  it("登録できる。タイトルは取りに行かない(取得の関数があっても呼ばない)", async () => {
    let called = false;
    const res = await addLink(testEnv().DB, { url: `${IG}?igsh=x`, date: "2026-10-10" }, { now: NOW, fetchTitle: async () => ((called = true), "x") });
    expect(res).toMatchObject({ ok: true, link: { kind: "instagram", url: IG, title: null } });
    expect(called).toBe(false);
  });
});

describe("parseLinkUrl: ウェブ(サイトを問わない)", () => {
  it.each([
    ["https://example.com/", "https://example.com/"],
    ["https://Www.Example.COM/Path/a?id=3&b=2#frag", "https://www.example.com/Path/a?id=3&b=2"],
    ["https://example.co.jp/movie?utm_source=x&utm_medium=y&fbclid=abc&gclid=1&page=2", "https://example.co.jp/movie?page=2"],
    ["https://xn--eckwd4c7c.example/a", "https://xn--eckwd4c7c.example/a"],
  ])("%s を正規化して受け付ける", (input, url) => {
    expect(parseLinkUrl(input)).toEqual({ ok: true, url, kind: "web" });
  });

  it.each([
    ["http://example.com/", "https"],
    ["https://localhost/a", "公開されたドメイン名"],
    ["https://intranet/a", "公開されたドメイン名"],
    ["https://printer.local/a", "公開されたドメイン名"],
    ["https://127.0.0.1/a", "IPアドレス"],
    ["https://[::1]/a", "IPアドレス"],
    ["https://2130706433/a", "IPアドレス"],
    ["https://example.com:8443/a", "ポート"],
    ["https://user:pw@example.com/a", "user:pass@"],
    ["https://例え.jp/a", "ASCII以外"],
    [`https://example.com/${"a".repeat(2100)}`, "長すぎ"],
  ])("%s は拒否する", (input, includes) => {
    const r = parseLinkUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(includes);
  });
});

describe("ウェブのリンクの登録と説明文", () => {
  const URL_WEB = "https://example.com/movie/1";

  it("fetchTitle を呼ばず、AI が渡した title / description を保存する", async () => {
    let called = false;
    const r = await addLink(
      db(),
      { url: URL_WEB, date: "2026-10-10", title: "映画の公式ページ", description: "公開日や上映館の案内" },
      { now: NOW, fetchTitle: async () => ((called = true), "取得しない") },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(called).toBe(false);
    expect(r.link).toMatchObject({ kind: "web", title: "映画の公式ページ", description: "公開日や上映館の案内" });
  });

  it("title が無くても、取りに行かず タイトルなしで登録する", async () => {
    let called = false;
    const r = await addLink(db(), { url: URL_WEB, date: "2026-10-10" }, { now: NOW, fetchTitle: async () => ((called = true), "x") });
    expect(r.ok && r.link.title).toBeNull();
    expect(called).toBe(false);
  });

  it("description は500文字まで", async () => {
    const r = await addLink(db(), { url: URL_WEB, date: "2026-10-10", description: "あ".repeat(501) }, { now: NOW });
    expect(r.ok).toBe(false);
  });

  it("updateLink は渡した項目だけ変える。null で消せる。どちらも無いとエラー", async () => {
    const added = await addLink(db(), { url: URL_WEB, date: "2026-10-10", title: "旧", description: "旧説明" }, { now: NOW });
    if (!added.ok) throw new Error("setup");
    const id = added.link.id;
    const a = await updateLink(db(), { id, description: "新説明" });
    expect(a.ok && a.link).toMatchObject({ title: "旧", description: "新説明" });
    const b = await updateLink(db(), { id, title: null });
    expect(b.ok && b.link).toMatchObject({ title: null, description: "新説明" });
    const c = await updateLink(db(), { id, description: null });
    expect(c.ok && c.link).toMatchObject({ title: null, description: null });
    expect((await updateLink(db(), { id })).ok).toBe(false);
  });
});
