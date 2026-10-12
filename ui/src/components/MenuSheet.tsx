import { useEffect, useRef } from "preact/hooks";
import { BrandMark } from "./BrandMark";
import { GITHUB_URL } from "../links";
import { menuItems } from "../menu";
import type { Route } from "../route";
import { navigate } from "../router";
import "./MenuSheet.css";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// スマホ幅の下のタブ「メニュー」から出る、下からのシート(モーダル)。毎日は使わない機能(カテゴリ・税額・エクスポート)への入口。
// リンクを押すとシートを閉じて移動する。×・Esc・背景のタップでも閉じる。DaySheet / MonthPicker と同じ作り
export function MenuSheet(props: { route: Route; onClose: () => void }) {
  const { route, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  // 開いたら閉じるボタンへフォーカス、閉じたら開いたタブへ戻す。背面のスクロールは止める
  useEffect(() => {
    opener.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>(".ms__close")?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    // フォーカストラップ: シートの外へ出さない
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  // 通常のクリックだけ、閉じて移動する(右クリック・新しいタブなどは <a> のまま)
  const onLink = (e: MouseEvent, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClose();
    navigate(href);
  };

  return (
    <div class="ms__backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="ms" role="dialog" aria-modal="true" aria-label="メニュー" ref={dialogRef} onKeyDown={onKeyDown}>
        <div class="ms__top">
          <img class="ms__logo" src="/brand/wordmark.svg" alt="Receipt to Life +" />
          <button class="ms__close" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        <h2 class="ms__heading brandmark-line"><BrandMark size={20} />メニュー</h2>
        <ul class="ms__list">
          {menuItems(route).map((item) => (
            <li key={item.href}>
              <a href={item.href} class={`ms__link${item.active ? " is-active" : ""}`} aria-current={item.active ? "page" : undefined} onClick={(e) => onLink(e, item.href)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  {item.d.map((d) => (
                    <path d={d} key={d} />
                  ))}
                </svg>
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <p class="ms__foot">
          Receipt to Life + ・ <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        </p>
      </div>
    </div>
  );
}
