import { useEffect, useState } from "preact/hooks";
import type { DayData, FieldError } from "../../../src/api/contract";
import { getDay, photoUrl } from "../api";
import { formatPeriodShort, txSubline } from "../calendar-layout";
import { formatDateJa, formatYen } from "../format";
import { Link } from "../router";
import "./DayPane.css";

type State = { status: "loading" } | { status: "error"; errors: FieldError[] } | { status: "ready"; data: DayData };

// PC幅のカレンダー右側に出す、選択した日の読み取り専用の詳細。編集は Day ページで行う
export function DayPane(props: { date: string }) {
  const { date } = props;
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getDay(date)
      .then((res) => {
        if (cancelled) return;
        setState(res.ok ? { status: "ready", data: res } : { status: "error", errors: res.errors });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: "error", errors: [{ field: "network", message: err instanceof Error ? err.message : "読み込めませんでした。" }] });
      });
    return () => {
      cancelled = true;
    };
  }, [date, reloadKey]);

  const data = state.status === "ready" ? state.data : null;

  return (
    <aside class="dp" aria-label={`${formatDateJa(date)}の詳細`} aria-busy={state.status === "loading"}>
      <section class="dp__card">
        <div class="dp__head">
          <h2 class="dp__date">{formatDateJa(date)}</h2>
          <span class="dp__total num">{data ? formatYen(data.total) : "—"}</span>
        </div>
        {data && <p class="dp__count muted">{data.count}件</p>}
        {state.status === "loading" && (
          <p class="muted" role="status">
            読み込み中…
          </p>
        )}
        {state.status === "error" && (
          <div role="alert">
            {state.errors.map((e, i) => (
              <p class="error" key={i}>
                {e.message}
              </p>
            ))}
            <button class="btn" type="button" onClick={() => setReloadKey((k) => k + 1)}>
              もう一度読み込む
            </button>
          </div>
        )}
        {data && data.transactions.length === 0 && <p class="muted">この日の支出はありません。</p>}
        {data && data.transactions.length > 0 && (
          <ul class="dp__list">
            {data.transactions.map((t) => (
              <li key={t.id} class="dp__tx">
                <div class="dp__tx-main">
                  <span class="dp__tx-name">{t.merchant ?? "店名なし"}</span>
                  <span class="dp__tx-sub muted">{txSubline(t)}</span>
                </div>
                <span class="dp__tx-amount num">{formatYen(t.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data && data.events.length > 0 && (
        <section class="dp__card">
          <h3 class="dp__sub">出来事</h3>
          <ul class="dp__events">
            {data.events.map((e) => (
              <li key={e.id} class={`dp__event dp__event--${e.color}`}>
                <span class="dp__event-title">{e.title}</span>
                <span class="dp__event-period muted num">{formatPeriodShort(e.start_date, e.end_date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.photos.length > 0 && (
        <section class="dp__card">
          <h3 class="dp__sub">写真</h3>
          <div class="dp__photos">
            {data.photos.map((p) => (
              <Link key={p.id} href={`/day/${date}`} class="dp__photo" aria-label={p.caption ? `写真: ${p.caption}` : "写真を開く"}>
                <img src={photoUrl(p.id)} alt={p.caption ?? ""} loading="lazy" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <Link class="btn dp__open" href={`/day/${date}`}>
        この日を開いて編集
      </Link>
    </aside>
  );
}
