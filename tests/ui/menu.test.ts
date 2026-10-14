import { describe, expect, it } from "vitest";
import { MENU_ITEMS, menuItems, sidebarItems, isMenuRoute } from "../../ui/src/menu";
import { parseRoute } from "../../ui/src/route";

describe("menuItems(スマホのメニュー)", () => {
  it("検索、カテゴリ、支払方法、サブスク・固定費、税額、エクスポート・バックアップ、AIとつなぐの順", () => {
    expect(menuItems().map((i) => i.label)).toEqual(["検索", "商品", "カテゴリ", "支払方法", "サブスク・固定費", "税額", "使用量", "エクスポート・バックアップ", "AIとつなぐ(MCP)"]);
    expect(menuItems().map((i) => i.href)).toEqual(["/search", "/products", "/categories", "/accounts", "/subscriptions", "/tax", "/usage", "/backup", "/connect"]);
  });

  it("リンク先は、すべて実在のルート(notfound ではない)", () => {
    for (const item of MENU_ITEMS) {
      expect(parseRoute(item.href).name, item.href).toBe(item.route);
      expect(parseRoute(item.href).name).not.toBe("notfound");
    }
  });

  it("リンク先・ラベル・ルート名に重複がない", () => {
    expect(new Set(MENU_ITEMS.map((i) => i.href)).size).toBe(MENU_ITEMS.length);
    expect(new Set(MENU_ITEMS.map((i) => i.label)).size).toBe(MENU_ITEMS.length);
    expect(new Set(MENU_ITEMS.map((i) => i.route)).size).toBe(MENU_ITEMS.length);
  });

  it("現在のページの項目だけ active になる", () => {
    expect(menuItems({ name: "tax" }).filter((i) => i.active).map((i) => i.href)).toEqual(["/tax"]);
    expect(menuItems({ name: "home" }).some((i) => i.active)).toBe(false);
  });

  it("アイコンの線画を持つ", () => {
    for (const item of MENU_ITEMS) expect(item.d.length).toBeGreaterThan(0);
  });
});

describe("sidebarItems(PCの左メニュー)", () => {
  it("ホーム・カレンダー・カテゴリ・口座・サブスク・固定費・税額・エクスポート・バックアップ。ラベルはメニューと同じ", () => {
    const items = sidebarItems();
    expect(items.map((i) => i.href)).toEqual(["/", "/calendar", "/search", "/products", "/categories", "/accounts", "/subscriptions", "/tax", "/usage", "/backup", "/connect"]);
    for (const m of MENU_ITEMS) expect(items.find((i) => i.href === m.href)?.label).toBe(m.label);
  });

  it("リンク先に重複がなく、すべて実在のルート", () => {
    const items = sidebarItems();
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
    for (const i of items) expect(parseRoute(i.href).name).not.toBe("notfound");
  });
});

describe("isMenuRoute", () => {
  it("メニューの項目のページにいるときだけ true(メニューのタブを現在地にする)", () => {
    expect(isMenuRoute({ name: "categories" })).toBe(true);
    expect(isMenuRoute({ name: "tax" })).toBe(true);
    expect(isMenuRoute({ name: "backup" })).toBe(true);
    expect(isMenuRoute({ name: "home" })).toBe(false);
    expect(isMenuRoute(parseRoute("/calendar"))).toBe(false);
  });
});
