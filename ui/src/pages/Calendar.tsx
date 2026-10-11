import { useEffect, useMemo, useState } from "preact/hooks";
import type { CalendarData, EventView, FieldError } from "../../../src/api/contract";
import { getCalendar } from "../api";
import { buildMonthGrid, eventEnd, laneCount, layoutWeekBands } from "../calendar-layout";
import { addMonths, formatDateJa, formatMonthJa, formatYen, monthOf, monthRange, todayJst } from "../format";
import { MonthPicker } from "../components/MonthPicker";
import { Link } from "../router";
import "./Calendar.css";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

type State = { status: "loading" } | { status: "error"; errors: FieldError[] } | { status: "ready"; data: CalendarData };

function periodText(e: EventView): string {
  const end = eventEnd(e);
  return end === e.start_date ? formatDateJa(e.start_date) : `${formatDateJa(e.start_date)} 〜 ${formatDateJa(end)}`;
}

export function Calendar(props: { month: string | null }) {
  const today = todayJst();
  const month = props.month ?? monthOf(today);
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getCalendar(month)
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
  }, [month, reloadKey]);

  const weeks = useMemo(() => buildMonthGrid(month), [month]);
  const data = state.status === "ready" ? state.data : null;
  const totals = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const addDate = monthOf(today) === month ? today : monthRange(month).from;

  return (
    <section class="page cal">
      <header class="cal__head">
        <Link class="cal__nav" href={`/calendar?month=${addMonths(month, -1)}`} aria-label="前の月">
          ‹
        </Link>
        <div class="cal__title">
          <h1 class="page__title">
            <button class="cal__pick" type="button" aria-label="年月を選んで移動" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen(true)}>
              {formatMonthJa(month)} <span aria-hidden="true">▾</span>
            </button>
          </h1>
          <p class="cal__total num" aria-live="polite">
            {data ? `合計 ${formatYen(data.total)}` : "合計 —"}
          </p>
        </div>
        <Link class="cal__nav" href={`/calendar?month=${addMonths(month, 1)}`} aria-label="次の月">
          ›
        </Link>
      </header>

      {pickerOpen && <MonthPicker month={month} todayMonth={monthOf(today)} onClose={() => setPickerOpen(false)} />}

      {state.status === "error" && (
        <div class="card" role="alert">
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
      {state.status === "loading" && <p class="muted" role="status">読み込み中…</p>}

      <div class="cal__grid card" aria-busy={state.status === "loading"}>
        <div class="cal__weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((w, i) => (
            <span key={w} class={`cal__wd${i === 0 ? " is-sun" : i === 6 ? " is-sat" : ""}`}>
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week) => {
          const bands = layoutWeekBands(week, data?.events ?? []);
          const lanes = laneCount(bands);
          return (
            <div class="cal__week" key={week[0]} style={{ "--lanes": lanes }}>
              {week.map((date, col) => {
                const day = totals.get(date);
                const cls = ["cal__day", col === 0 ? "is-sun" : col === 6 ? "is-sat" : "", monthOf(date) !== month ? "is-out" : "", date === today ? "is-today" : ""]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <Link key={date} href={`/day/${date}`} class={cls} aria-label={`${formatDateJa(date)}${day ? ` ${formatYen(day.total)}(${day.count}件)` : ""}`}>
                    <span class="cal__date num">{Number(date.slice(8))}</span>
                    <span class="cal__amount num">{day ? formatYen(day.total) : ""}</span>
                  </Link>
                );
              })}
              {bands.map((b) => (
                <span
                  key={b.event.id}
                  class={`cal__band cal__band--${b.event.color}${b.continuesBefore ? " is-cont-before" : ""}${b.continuesAfter ? " is-cont-after" : ""}`}
                  style={{ "--col": b.startCol, "--span": b.endCol - b.startCol + 1, "--lane": b.lane }}
                  role="img"
                  aria-label={`出来事: ${b.event.title}(${periodText(b.event)})`}
                >
                  <span class="cal__band-text">{b.event.title}</span>
                </span>
              ))}
            </div>
          );
        })}
      </div>

      <div class="card cal__events">
        <h2 class="cal__events-title">今月の出来事</h2>
        {state.status === "ready" && state.data.events.length === 0 && <p class="muted">この月の出来事はありません。</p>}
        {data && data.events.length > 0 && (
          <ul class="cal__list">
            {[...data.events]
              .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
              .map((e) => (
                <li key={e.id}>
                  <Link class="cal__item" href={`/day/${e.start_date}`}>
                    <span class={`cal__dot cal__dot--${e.color}`} aria-hidden="true" />
                    <span class="cal__item-title">{e.title}</span>
                    <span class="cal__item-period muted">{periodText(e)}</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
        <Link class="btn cal__add" href={`/day/${addDate}`}>
          出来事を追加
        </Link>
      </div>
    </section>
  );
}
