import { useEffect, useRef } from "preact/hooks";
import { DayPane } from "./DayPane";
import "./DaySheet.css";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// スマホ幅のカレンダーで、日をタップしたときに下から出る読み取り専用のプレビュー(PC幅の右ペインと同じ中身)。
// 「詳細を開く」でその日のページへ移る。×・Esc・背景のタップで閉じる
export function DaySheet(props: { date: string; onClose: () => void }) {
  const { date, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  // 開いたら閉じるボタンへフォーカス、閉じたら開いた日のセルへ戻す。背面のスクロールは止める
  useEffect(() => {
    opener.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>(".ds__close")?.focus();
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

  return (
    <div class="ds__backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="ds" role="dialog" aria-modal="true" aria-label="この日のプレビュー" ref={dialogRef} onKeyDown={onKeyDown}>
        <div class="ds__top">
          <span class="ds__grip" aria-hidden="true" />
          <button class="ds__close" type="button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        <DayPane date={date} />
      </div>
    </div>
  );
}
