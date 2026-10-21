import { useEffect, useState } from "preact/hooks";
import { navigate } from "../router";
import { useNotices } from "../notices";
import "./NoticeBell.css";

const BELL = ["M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z", "M10 21h4"];

// ヘッダーの「お知らせ」。あるときは色がつき、数が出る。押すと、一覧が開く(押すと、その画面へ移る)
export function NoticeBell(props: { class?: string }) {
  const notices = useNotices();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const n = notices.length;
  return (
    <div class={`notice ${props.class ?? ""}`}>
      <button type="button" class={`notice__btn${n > 0 ? " has-notice" : ""}${notices.some((x) => x.level === "danger") ? " has-danger" : ""}`} aria-label={n > 0 ? `お知らせ ${n}件` : "お知らせ"} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          {BELL.map((d) => (
            <path d={d} key={d} />
          ))}
        </svg>
        {n > 0 && <span class="notice__count">{n}</span>}
      </button>
      {open && (
        <>
          <div class="notice__backdrop" onClick={() => setOpen(false)} />
          <div class="notice__panel" role="dialog" aria-label="お知らせ">
            <h2 class="notice__h">お知らせ</h2>
            {n === 0 ? (
              <p class="notice__empty">新しいお知らせはありません。</p>
            ) : (
              <ul class="notice__list">
                {notices.map((item) => (
                  <li key={item.id}>
                    <a
                      class={`notice__item is-${item.level}`}
                      href={item.href}
                      onClick={(e) => {
                        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        setOpen(false);
                        navigate(item.href);
                      }}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
