import { useEffect, useRef, useState } from "preact/hooks";
import { isValidDate, MAX_YEAR, MIN_YEAR, monthButtons, monthHref, parseYear, shiftYear } from "../month-picker";
import { navigate } from "../router";
import "./MonthPicker.css";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// 年月を選んで移動するシート(モーダル)。選ぶと移動して閉じる。Esc・背景のタップでも閉じる
export function MonthPicker(props: { month: string; todayMonth: string; onClose: () => void }) {
  const { month, todayMonth, onClose } = props;
  const [year, setYear] = useState(() => parseYear(month));
  const [date, setDate] = useState("");
  const [dateError, setDateError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  // 開いたら選択中の月へ、閉じたら開いたボタンへフォーカスを戻す。背面のスクロールは止める
  useEffect(() => {
    opener.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('[aria-pressed="true"], .mp__month')?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const root = dialogRef.current;
    if (!root) return;
    if (e.key === "Tab") {
      // フォーカストラップ: ダイアログの外へ出さない
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
      return;
    }
    // 月のボタン上の矢印キー: 左右で1か月、上下で3か月(年の範囲内で止める)
    const target = e.target as HTMLElement;
    if (target.classList.contains("mp__month")) {
      const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -3 : e.key === "ArrowDown" ? 3 : 0;
      if (step === 0) return;
      e.preventDefault();
      const buttons = Array.from(root.querySelectorAll<HTMLElement>(".mp__month"));
      const next = buttons[buttons.indexOf(target) + step];
      next?.focus();
    }
  };

  const submitDate = (e: Event) => {
    e.preventDefault();
    if (!isValidDate(date)) {
      setDateError(`${MIN_YEAR}年〜${MAX_YEAR}年の日付を選んでください。`);
      return;
    }
    go(`/day/${date}`);
  };

  return (
    <div class="mp__backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="mp" role="dialog" aria-modal="true" aria-labelledby="mp-title" ref={dialogRef} onKeyDown={onKeyDown}>
        <div class="mp__top">
          <h2 id="mp-title" class="mp__title">年月を選んで移動</h2>
          <button class="mp__today" type="button" onClick={() => go(monthHref(todayMonth))}>
            今月へ
          </button>
        </div>

        <div class="mp__year">
          <button class="mp__yearbtn" type="button" aria-label="前の年" disabled={year <= MIN_YEAR} onClick={() => setYear(shiftYear(year, -1))}>
            ‹
          </button>
          <span class="mp__yeartext num" aria-live="polite">{year}年</span>
          <button class="mp__yearbtn" type="button" aria-label="次の年" disabled={year >= MAX_YEAR} onClick={() => setYear(shiftYear(year, 1))}>
            ›
          </button>
        </div>

        <div class="mp__months" role="group" aria-label={`${year}年の月`}>
          {monthButtons(year, todayMonth, month).map((b) => (
            <button
              key={b.month}
              type="button"
              class={`mp__month${b.current ? " is-current" : ""}${b.selected ? " is-selected" : ""}`}
              aria-pressed={b.selected}
              aria-label={`${year}年${b.label}${b.current ? "(今月)" : ""}`}
              onClick={() => go(monthHref(b.month))}
            >
              {b.label}
            </button>
          ))}
        </div>

        <form class="mp__date" onSubmit={submitDate}>
          <label class="mp__label" for="mp-date">日付を指定して移動</label>
          <div class="mp__row">
            <input
              id="mp-date"
              class="mp__input"
              type="date"
              value={date}
              min={`${MIN_YEAR}-01-01`}
              max={`${MAX_YEAR}-12-31`}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? "mp-date-error" : undefined}
              onInput={(e) => {
                setDate((e.currentTarget as HTMLInputElement).value);
                setDateError("");
              }}
            />
            <button class="btn mp__go" type="submit">
              移動
            </button>
          </div>
          {dateError && (
            <p id="mp-date-error" class="error" role="alert">
              {dateError}
            </p>
          )}
        </form>

        <button class="mp__close" type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
