import { useRef, useState } from "preact/hooks";
import { copyMessage, copyOrSelect } from "../clipboard";

// 値と「コピー」ボタン。クリップボードが使えないときは、値のテキストを選択状態にする(長押しなどでコピーできる)
export function CopyValue(props: { text: string; label: string; class?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  function select() {
    const el = ref.current;
    const selection = window.getSelection();
    if (!el || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function copy() {
    const clipboard = typeof navigator !== "undefined" && window.isSecureContext ? navigator.clipboard : undefined;
    const outcome = await copyOrSelect(props.text, clipboard, select);
    setMessage(copyMessage(outcome, props.label));
  }

  return (
    <span class="copyval">
      <span class={`copyval__text ${props.class ?? ""}`} ref={ref}>
        {props.text}
      </span>
      <button type="button" class="btn copyval__btn" onClick={() => void copy()} aria-label={`${props.label}をコピー`}>
        コピー
      </button>
      {message && (
        <span class="copyval__msg muted" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
