import { useEffect, useRef, useState } from "preact/hooks";
import type { CategoriesData, MerchantView } from "../../../src/api/contract";
import { getMerchants } from "../api";
import { chipIcon } from "../categoryIcons";
import { todayJst } from "../format";
import { isImeEnter, lastUsedLabel, merchantsPath, moveActive, optionLabel, SUGGEST_DEBOUNCE_MS, usageLabel } from "../merchantSuggest";
import { CategoryChip } from "./CategoryIcon";

type Status = "idle" | "loading" | "ready" | "error";

// 店名の入力欄(WAI-ARIA のコンボボックス)。入力のたびに(約150ms 待って)過去の店を絞り込んで候補に出す。
// 候補の取得に失敗しても入力は続けられる。選んだときの自動入力は、親(onPick)が決める
export function MerchantCombobox(props: { id: string; value: string; cats: CategoriesData; onInput: (value: string) => void; onPick: (m: MerchantView) => void }) {
  const { id } = props;
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [items, setItems] = useState<MerchantView[]>([]);
  const [active, setActive] = useState(-1);
  const composing = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  // 古い応答が新しい入力の結果を上書きしないよう、最後の要求だけ採用する
  const seq = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function schedule(raw: string) {
    window.clearTimeout(timer.current);
    const path = merchantsPath(raw);
    seq.current += 1;
    if (path === null) {
      setOpen(false);
      setItems([]);
      setStatus("idle");
      setActive(-1);
      return;
    }
    const mine = seq.current;
    setStatus("loading");
    setOpen(true);
    timer.current = window.setTimeout(() => {
      void getMerchants(path)
        .then((res) => {
          if (mine !== seq.current) return;
          if (res.ok) {
            setItems(res.merchants);
            setStatus("ready");
            setActive(-1);
          } else {
            setItems([]);
            setStatus("error");
          }
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setItems([]);
          setStatus("error");
        });
    }, SUGGEST_DEBOUNCE_MS);
  }

  function close() {
    window.clearTimeout(timer.current);
    seq.current += 1;
    setOpen(false);
    setActive(-1);
  }

  function pick(m: MerchantView) {
    close();
    setItems([]);
    setStatus("idle");
    props.onPick(m);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (items.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((cur) => moveActive(cur, items.length, e.key as "ArrowDown" | "ArrowUp"));
    } else if (e.key === "Enter") {
      // 変換の確定の Enter は決定にしない。候補を選んでいるときだけ決定し、フォームの送信は止める
      if (isImeEnter(e, composing.current)) return;
      const m = open ? items[active] : undefined;
      if (m) {
        e.preventDefault();
        pick(m);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  }

  const today = todayJst();
  const showList = open && status === "ready" && items.length > 0;
  const message =
    !open || props.value.trim() === ""
      ? null
      : status === "loading"
        ? "候補を探しています…"
        : status === "error"
          ? "候補を読み込めませんでした(そのまま入力を続けられます)"
          : status === "ready" && items.length === 0
            ? "新しい店として登録します"
            : null;

  return (
    <div class="mcombo">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellcheck={false}
        value={props.value}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          props.onInput(v);
          schedule(v);
        }}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onBlur={close}
      />
      {showList && (
        // 項目を押したときに入力欄の blur で先に閉じないよう、押下の既定動作(フォーカス移動)を止める
        <ul id={listId} role="listbox" aria-label="過去の店の候補" class="mcombo__list" onMouseDown={(e) => e.preventDefault()}>
          {items.map((m, i) => (
            <li
              id={`${id}-opt-${i}`}
              key={m.merchant}
              role="option"
              aria-selected={i === active}
              aria-label={optionLabel(m, today)}
              class={`mcombo__opt${i === active ? " is-active" : ""}`}
              onClick={() => pick(m)}
              onMouseMove={() => i !== active && setActive(i)}
            >
              <span class="mcombo__name">{m.merchant}</span>
              <span class="mcombo__sub">
                {m.category && <CategoryChip label={m.category} icon={chipIcon(props.cats, m.category)} />}
                {m.phone && <span class="num">{m.phone}</span>}
              </span>
              <span class="mcombo__meta muted">
                最後 {lastUsedLabel(m.last_date, today)} ・ {usageLabel(m.count)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p class="mcombo__status muted" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
