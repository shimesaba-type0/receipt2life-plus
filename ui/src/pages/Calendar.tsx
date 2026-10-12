import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { BrandMark } from "../components/BrandMark";
import type { CalendarData, EventView, FieldError } from "../../../src/api/contract";
import { getCalendar } from "../api";
import { buildMonthGrid, defaultSelectedDate, eventEnd, formatCellAmount, formatPeriodShort, laneCount, layoutWeekBands } from "../calendar-layout";
import { addMonths, formatDateJa, formatMonthJa, formatYen, monthOf, monthRange, todayJst } from "../format";
import { formatHolidayDate, holidayName, holidaysInMonth } from "../holidays";
import { DayPane } from "../components/DayPane";
import { MonthPicker } from "../components/MonthPicker";
import { Link, navigate } from "../router";
import "./Calendar.css";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

type State = { status: "loading" } | { status: "error"; errors: FieldError[] } | { status: "ready"; data: CalendarData };

// 読み上げ用の期間(長い表記)。画面の表示は formatPeriodShort
function periodText(e: EventView): string {
  const end = eventEnd(e);
  return end === e.start_date ? formatDateJa(e.start_date) : `${formatDateJa(e.start_date)} 〜 ${formatDateJa(end)}`;
}

// PC幅(2ペイン)かどうか。900px は styles.css の左メニューの切り替えと同じ
const WIDE_QUERY = "(min-width: 900px)";
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

function ChevronIcon(props: { dir: "left" | "right" | "down" }) {
  const d = props.dir === "left" ? "M15 6l-6 6 6 6" : props.dir === "right" ? "M9 6l6 6-6 6" : "M7 10l5 5 5-5";
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function Calendar(props: { month: string | null }) {
  const today = todayJst();
  const month = props.month ?? monthOf(today);
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const wide = useWide();
  const [picked, setPicked] = useState<string | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  // 月を移動したら、選択日は既定(今日か月初)に戻す
  useEffect(() => setPicked(null), [month]);
  const selected = picked ?? defaultSelectedDate(month, today);
  // スマホ幅: 日をタップしてプレビューが出たら、見える位置まで最小限だけスクロールする
  useEffect(() => {
    if (!wide && picked) previewRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked, wide]);

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
  const holidays = useMemo(() => holidaysInMonth(month), [month]);
  const addDate = monthOf(today) === month ? today : monthRange(month).from;

  return (
    <section class="page cal">
      <header class="cal__head">
        <div class="cal__sum">
          <span class="cal__sum-label">{Number(month.slice(5))}月の合計</span>
          <span class="cal__total num" aria-live="polite">
            {data ? formatYen(data.total) : "—"}
          </span>
        </div>
        <div class="cal__nav-group">
          <Link class="cal__nav" href={`/calendar?month=${addMonths(month, -1)}`} aria-label="前の月">
            <ChevronIcon dir="left" />
          </Link>
          <h1 class="cal__title">
            <button class="cal__pick" type="button" aria-label="年月を選んで移動" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen(true)}>
              {formatMonthJa(month)}
              <ChevronIcon dir="down" />
            </button>
          </h1>
          <Link class="cal__nav" href={`/calendar?month=${addMonths(month, 1)}`} aria-label="次の月">
            <ChevronIcon dir="right" />
          </Link>
        </div>
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
      {state.status === "loading" && <p class="muted" role="status"><BrandMark size={20} faint />{" "}読み込み中…</p>}

      <div class="cal__layout">
      <div class="cal__main">
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
                const holiday = holidayName(date);
                const cls = ["cal__day", col === 0 ? "is-sun" : col === 6 ? "is-sat" : "", holiday ? "is-holiday" : "", monthOf(date) !== month ? "is-out" : "", date === today ? "is-today" : ""]
                  .filter(Boolean)
                  .join(" ");
                const onClick = (e: MouseEvent) => {
                  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  // PC幅は右ペイン、スマホ幅は「今月の出来事」の下のプレビューを、タップした日に切り替える(詳細はそこから開く)
                  setPicked(date);
                };
                // PC幅のダブルクリックで、その日の詳細ページへ移る(1回目のクリックで右ペインの選択は済んでいる)
                const onDblClick = (e: MouseEvent) => {
                  if (!wide || e.defaultPrevented || e.button !== 0) return;
                  e.preventDefault();
                  navigate(`/day/${date}`);
                };
                return (
                  <a
                    key={date}
                    href={`/day/${date}`}
                    class={`${cls}${(wide || picked) && date === selected ? " is-selected" : ""}`}
                    onClick={onClick}
                    onDblClick={onDblClick}
                    aria-current={(wide || picked) && date === selected ? "date" : undefined}
                    aria-label={`${formatDateJa(date)}${holiday ? ` ${holiday}` : ""}${day ? ` ${formatYen(day.total)}(${day.count}件)` : ""}`}
                  >
                    <span class="cal__date num">{Number(date.slice(8))}</span>
                    {holiday && (
                      <span class="cal__hol" aria-hidden="true">
                        <span class="cal__hol-short">祝</span>
                        <span class="cal__hol-name">{holiday}</span>
                      </span>
                    )}
                    <span class="cal__amount num">{formatCellAmount(day?.total)}</span>
                  </a>
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

      <section class="cal__events" aria-label="今月の出来事">
        <h2 class="cal__events-title">今月の出来事</h2>
        {state.status === "ready" && state.data.events.length === 0 && <p class="muted cal__empty">この月の出来事はありません。</p>}
        {data && data.events.length > 0 && (
          <ul class="cal__list">
            {[...data.events]
              .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
              .map((e) => (
                <li key={e.id}>
                  <Link class="cal__item" href={`/day/${e.start_date}`} aria-label={`${e.title}(${periodText(e)})`}>
                    <span class={`cal__dot cal__dot--${e.color}`} aria-hidden="true" />
                    <span class="cal__item-title">{e.title}</span>
                    <span class="cal__item-period muted num">{formatPeriodShort(e.start_date, e.end_date)}</span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
        <Link class="cal__add" href={`/day/${addDate}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          出来事を追加
        </Link>
      </section>

      {!wide && picked && (
        <section class="cal__preview" aria-label="タップした日のプレビュー" ref={previewRef}>
          <DayPane date={picked} />
        </section>
      )}

      {holidays.length > 0 && (
        <section class="cal__events" aria-label="今月の祝日">
          <h2 class="cal__events-title">今月の祝日</h2>
          <ul class="cal__list">
            {holidays.map((h) => (
              <li key={h.date}>
                <div class="cal__item cal__item--holiday">
                  <span class="cal__hol-date num">{formatHolidayDate(h.date)}</span>
                  <span class="cal__item-title">{h.name}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
      {wide && (
        <div class="cal__side">
          <DayPane date={selected} />
        </div>
      )}
      </div>
    </section>
  );
}
