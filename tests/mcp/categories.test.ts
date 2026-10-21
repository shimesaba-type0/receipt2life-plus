import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { testEnv } from "../helpers";

const env = () => ({ DB: testEnv().DB, AUTH_BYPASS: "1" });

async function rpc(method: string, params?: unknown) {
  const res = await createApp().request(
    "http://localhost/mcp",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    env(),
  );
  return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const callTool = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
const text = (r: Awaited<ReturnType<typeof rpc>>) => JSON.parse(r.body.result.content[0].text);

describe("MCP のカテゴリ管理", () => {
  it("4つのツールがあり、説明に使いどころが日本語で書かれている", async () => {
    const r = await rpc("tools/list");
    const tools = r.body.result.tools as { name: string; description: string }[];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["add_category", "update_category", "delete_category", "rename_group", "list_categories"]));
    // 15個 + カテゴリ管理の4つ + 口座管理の3つ
    expect(tools).toHaveLength(43);
    const get = (n: string) => tools.find((t) => t.name === n)!.description;
    expect(get("add_category")).toContain("大分類");
    expect(get("add_category")).toContain("add_transactions");
    expect(get("delete_category")).toContain("move_to");
    expect(get("rename_group")).toContain("統合");
    expect(get("list_categories")).toContain("usage");
  });

  it("追加 → 一覧(大分類のまとまりと usage)→ 登録に使う", async () => {
    const added = await callTool("add_category", { name: "光熱費", group_name: "住まい" });
    expect(text(added)).toMatchObject({ ok: true, category: { name: "光熱費", group_name: "住まい" }, created_group: true });

    const tx = await callTool("add_transactions", { transactions: [{ amount: 8000, merchant: "電力会社", category: "光熱費" }] });
    expect(text(tx)).toMatchObject({ ok: true, registered: [{ category: "光熱費", status: "ok" }] });

    const list = text(await callTool("list_categories", {}));
    expect(list.groups.at(-1)).toEqual({ group_name: "住まい", categories: [{ name: "光熱費", icon: null, usage: 1 }] });
    expect(list.categories.find((c: { name: string }) => c.name === "光熱費")).toEqual({ name: "光熱費", group_name: "住まい", icon: null, usage: 1 });
  });

  it("重複はエラー(isError)", async () => {
    const r = await callTool("add_category", { name: "食費", group_name: "食費" });
    expect(r.body.result.isError).toBe(true);
    expect(text(r)).toMatchObject({ ok: false, errors: [{ field: "name" }] });
  });

  it("update_category / rename_group / delete_category(使用中は move_to が必要)", async () => {
    await callTool("add_transactions", { transactions: [{ amount: 300, merchant: "A店", category: "娯楽" }] });
    expect(text(await callTool("update_category", { name: "娯楽", new_name: "趣味" }))).toMatchObject({ ok: true, category: { name: "趣味", usage: 1 } });
    expect(text(await callTool("rename_group", { group: "娯楽", new_name: "遊び" }))).toMatchObject({ ok: true, updated: 1 });

    const refused = await callTool("delete_category", { name: "趣味" });
    expect(refused.body.result.isError).toBe(true);
    expect(text(refused).errors[0].message).toContain("move_to");

    expect(text(await callTool("delete_category", { name: "趣味", move_to: "その他" }))).toMatchObject({ ok: true, moved: 1, move_to: "その他" });
  });

  it("未知の項目・空の入力はエラーになる", async () => {
    const r = await callTool("update_category", { name: "食費" });
    expect(r.body.result.isError).toBe(true);
    const bad = await callTool("add_category", { name: "", group_name: "食費" });
    expect(bad.body.result.isError).toBe(true);
  });
});

describe("MCP のカテゴリのアイコン", () => {
  it("add_category / update_category の説明にアイコンのキーと意味が載る。list_categories は icon を返す", async () => {
    const tools = (await rpc("tools/list")).body.result.tools as { name: string; description: string; inputSchema: { properties: Record<string, unknown> } }[];
    for (const n of ["add_category", "update_category"]) {
      const t = tools.find((x) => x.name === n)!;
      expect(t.description).toContain("taxi=タクシー");
      expect(t.description).toContain("bigspend=大型出費");
      expect(Object.keys(t.inputSchema.properties)).toContain("icon");
    }
    expect(tools.find((x) => x.name === "list_categories")!.description).toContain("icon");
  });

  it("追加(icon つき)→ 一覧 → 変更 → 外す", async () => {
    expect(text(await callTool("add_category", { name: "タクシー", group_name: "交通", icon: "taxi" }))).toMatchObject({ ok: true, category: { icon: "taxi" } });
    const list = text(await callTool("list_categories", {}));
    expect(list.categories.find((c: { name: string }) => c.name === "タクシー").icon).toBe("taxi");
    expect(list.categories.find((c: { name: string }) => c.name === "食費").icon).toBe("food");
    expect(text(await callTool("update_category", { name: "タクシー", icon: "car" }))).toMatchObject({ ok: true, category: { icon: "car" } });
    expect(text(await callTool("update_category", { name: "タクシー", icon: null }))).toMatchObject({ ok: true, category: { icon: null } });
  });

  it("一覧にない icon はエラー(選べるキーが返る)", async () => {
    const r = await callTool("add_category", { name: "謎", group_name: "その他", icon: "rocket" });
    expect(r.body.result.isError).toBe(true);
    expect(JSON.stringify(r.body.result)).toContain("taxi=タクシー");
  });
});

describe("MCP の口座管理", () => {
  it("3つのツールがあり、説明に確認・表記ゆれ・list_categories が書かれている", async () => {
    const tools = (await rpc("tools/list")).body.result.tools as { name: string; description: string }[];
    const get = (n: string) => tools.find((t) => t.name === n)?.description ?? "";
    expect(get("add_account")).toContain("利用者に確認");
    expect(get("add_account")).toContain("表記ゆれ");
    expect(get("add_account")).toContain("list_categories");
    expect(get("update_account")).toContain("new_name");
    expect(get("delete_account")).toContain("move_to");
  });

  it("追加 → 名前変更 → 登録に使う → 削除(使用中は move_to が必要)", async () => {
    expect(text(await callTool("add_account", { name: "電子マネーA" }))).toMatchObject({ ok: true, account: { name: "電子マネーA", usage: 0 } });
    expect(text(await callTool("list_categories", {})).accounts).toContain("電子マネーA");
    expect(text(await callTool("update_account", { name: "電子マネーA", new_name: "電子マネーB" }))).toMatchObject({ ok: true, account: { name: "電子マネーB" } });

    const tx = await callTool("add_transactions", { transactions: [{ amount: 300, merchant: "A店", category: "食費", account: "電子マネーB" }] });
    expect(text(tx)).toMatchObject({ ok: true, registered: [{ account: "電子マネーB" }] });

    const refused = await callTool("delete_account", { name: "電子マネーB" });
    expect(refused.body.result.isError).toBe(true);
    expect(text(refused).errors[0].message).toContain("move_to");
    expect(text(await callTool("delete_account", { name: "電子マネーB", move_to: "現金" }))).toMatchObject({ ok: true, moved: 1, move_to: "現金" });
  });

  it("重複・未知の口座・空はエラー(isError)。未知の口座名での登録は従来どおりエラー", async () => {
    expect((await callTool("add_account", { name: "現金" })).body.result.isError).toBe(true);
    expect((await callTool("add_account", { name: "" })).body.result.isError).toBe(true);
    expect((await callTool("update_account", { name: "なし", new_name: "x" })).body.result.isError).toBe(true);
    expect((await callTool("delete_account", { name: "なし" })).body.result.isError).toBe(true);
    const tx = await callTool("add_transactions", { transactions: [{ amount: 300, merchant: "A店", category: "食費", account: "未登録" }] });
    expect(tx.body.result.isError).toBe(true);
  });
});
