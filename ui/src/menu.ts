// メニューの項目(純粋な部分。DOMに触れない。テストする)。
// スマホは下のタブ「メニュー」から出るシート、PCは左メニューにそのまま並べる。どちらも既存のページへのリンクだけ
import { CALENDAR_ICON, CATEGORY_ICON, CONNECT_ICON, EXPORT_ICON, HOME_ICON, TAX_ICON } from "./icons";
import type { Route } from "./route";

export interface MenuItem {
  route: Route["name"];
  href: string;
  label: string;
  d: string[];
}

// 毎日は使わない機能の置き場。順番は、このまま表示する(ラベルはスマホ・PCで同じ)
export const MENU_ITEMS: MenuItem[] = [
  { route: "categories", href: "/categories", label: "カテゴリ・口座", d: CATEGORY_ICON },
  { route: "tax", href: "/tax", label: "税額", d: TAX_ICON },
  { route: "backup", href: "/backup", label: "エクスポート・バックアップ", d: EXPORT_ICON },
  { route: "connect", href: "/connect", label: "AIとつなぐ(MCP)", d: CONNECT_ICON },
];

export interface ActiveItem extends MenuItem {
  active: boolean;
}

/** シートに並べる項目。現在のページの項目は active */
export function menuItems(route?: Pick<Route, "name">): ActiveItem[] {
  return MENU_ITEMS.map((item) => ({ ...item, active: route?.name === item.route }));
}

/** PCの左メニューに並べる項目(ホーム・カレンダーのあとにメニューの項目) */
export function sidebarItems(route?: Pick<Route, "name">): ActiveItem[] {
  const base: MenuItem[] = [
    { route: "home", href: "/", label: "ホーム", d: HOME_ICON },
    { route: "calendar", href: "/calendar", label: "カレンダー", d: CALENDAR_ICON },
  ];
  return [...base, ...MENU_ITEMS].map((item) => ({ ...item, active: route?.name === item.route }));
}

/** いま見ているページが、メニューの項目か(下のタブの「メニュー」を現在地にする) */
export function isMenuRoute(route: Pick<Route, "name">): boolean {
  return MENU_ITEMS.some((item) => item.route === route.name);
}
