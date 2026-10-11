import type { Route } from "../route";
import { Link } from "../router";
import { todayJst } from "../format";

function Icon(props: { d: string[] }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.d.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

// スマホは下のタブ、PCは左のメニュー(CSSで切り替える)
export function Nav(props: { route: Route }) {
  const { route } = props;
  const today = todayJst();
  // 下のタブは「ホーム/カレンダー/今日」、左メニューは「ホーム/カレンダー/エクスポート」(今日はホームの緑ボタンで開く)
  const items = [
    { href: "/", label: "ホーム", active: route.name === "home", d: ["M4 11l8-7 8 7", "M6 10v10h12V10"] },
    { href: "/calendar", label: "カレンダー", active: route.name === "calendar", d: ["M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M4 10h16M9 3v4M15 3v4"] },
    { href: `/day/${today}`, label: "今日", active: route.name === "day" && route.date === today, mobileOnly: true, d: ["M5 5h14v14H5z", "M9 10h6M9 14h4"] },
  ];
  return (
    <nav class="nav" aria-label="メイン">
      <span class="nav__brand">receipt2life+</span>
      {items.map((item) => (
        <Link href={item.href} class={`nav__item${item.active ? " is-active" : ""}${"mobileOnly" in item ? " nav__item--mobile" : ""}`} aria-current={item.active ? "page" : undefined}>
          <Icon d={item.d} />
          <span>{item.label}</span>
        </Link>
      ))}
      <Link href="/backup" class={`nav__item nav__export${route.name === "backup" ? " is-active" : ""}`} aria-current={route.name === "backup" ? "page" : undefined}>
        <Icon d={["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"]} />
        <span>エクスポート</span>
      </Link>
    </nav>
  );
}
