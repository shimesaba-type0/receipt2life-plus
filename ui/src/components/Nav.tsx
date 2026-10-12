import { useEffect, useState } from "preact/hooks";
import { MENU_ICON, TODAY_ICON } from "../icons";
import { isMenuRoute, sidebarItems } from "../menu";
import type { Route } from "../route";
import { Link } from "../router";
import { todayJst } from "../format";
import { MenuSheet } from "./MenuSheet";

function Icon(props: { d: string[] }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.d.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

// スマホは下のタブ(ホーム/カレンダー/今日/メニュー)、PCは左のメニュー(CSSで切り替える)。
// 下のタブの「メニュー」は、毎日は使わない機能(カテゴリ・税額・エクスポート)のシートを開く。PCの左メニューは、それをそのまま並べる
export function Nav(props: { route: Route }) {
  const { route } = props;
  const today = todayJst();
  const [menuOpen, setMenuOpen] = useState(false);

  // PC幅に切り替わったら、シートは閉じる(PCの左メニューに同じ項目がある)
  useEffect(() => {
    if (!menuOpen) return;
    const mq = window.matchMedia("(min-width: 900px)");
    const onChange = () => mq.matches && setMenuOpen(false);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [menuOpen]);

  const items = sidebarItems(route);
  const menuActive = isMenuRoute(route);
  return (
    <>
      <nav class="nav" aria-label="メイン">
        <div class="nav__brand">
          <img class="nav__logo" src="/brand/wordmark.svg" alt="Receipt to Life +" />
        </div>
        {items.map((item) => (
          // 下のタブは「ホーム/カレンダー/今日/メニュー」。カテゴリ・税額・エクスポートは PC の左メニューだけに並べる
          <Link href={item.href} class={`nav__item${item.active ? " is-active" : ""}${item.route === "home" || item.route === "calendar" ? "" : " nav__pc"}`} aria-current={item.active ? "page" : undefined}>
            <Icon d={item.d} />
            <span>{item.label}</span>
          </Link>
        ))}
        <Link href={`/day/${today}`} class={`nav__item nav__item--mobile${route.name === "day" && route.date === today ? " is-active" : ""}`} aria-current={route.name === "day" && route.date === today ? "page" : undefined}>
          <Icon d={TODAY_ICON} />
          <span>今日</span>
        </Link>
        <button type="button" class={`nav__item nav__item--mobile nav__menu${menuActive ? " is-active" : ""}`} aria-haspopup="dialog" aria-expanded={menuOpen} aria-current={menuActive ? "true" : undefined} onClick={() => setMenuOpen(true)}>
          <Icon d={MENU_ICON} />
          <span>メニュー</span>
        </button>
      </nav>
      {menuOpen && <MenuSheet route={route} onClose={() => setMenuOpen(false)} />}
    </>
  );
}
