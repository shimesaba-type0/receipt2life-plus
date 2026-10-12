import { todayJst } from "../format";
import { Link } from "../router";

// PC幅の画面の上に通す横長のヘッダー。左にロゴ、右に「今日の記録を開く」(どのページからでも今日へ)。スマホ幅では出さない(CSSで切り替える)
export function Topbar() {
  const today = todayJst();
  return (
    <header class="topbar">
      <Link href="/" class="topbar__home">
        <img class="topbar__logo" src="/brand/wordmark.svg" alt="Receipt to Life +" />
      </Link>
      <Link href={`/day/${today}`} class="topbar__today">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        今日の記録を開く
      </Link>
    </header>
  );
}
