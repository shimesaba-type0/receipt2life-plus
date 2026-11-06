import { useEffect, useRef, useState } from "preact/hooks";
import type { SeatRecordView, SeatRecordsData } from "../../../src/api/contract";
import { getSeatRecord, getSeatRecords } from "../api";
import { BookCover } from "../components/BookCover";
import { Link, navigate } from "../router";
import { errorText } from "./categoriesLogic";
import { PAGE_SIZES, clampPanelWidth, isYearSelected, pageCountOf, yearRange } from "./booksLogic";
import { readPageSize, readPanelWidth, savePageSize, savePanelWidth } from "./booksStorage";
import { Pager, sheetSwipe } from "./Books";
import { SeatChairs } from "../components/SeatChairs";
import { movieCountText, movieHeading, ratingStars, seatText } from "./moviesLogic";
import "./Categories.css";
import "./Books.css";

interface Filter {
  q: string;
  venue: string;
  from: string;
  to: string;
  minRating: number;
}
const NO_FILTER: Filter = { q: "", venue: "", from: "", to: "", minRating: 0 };

// 映画: 座席の記録を、ポスターの並びで見る。押すと、一覧を残したまま詳細(PCは右、スマホは下のシート)。直すのは、その日の画面か AI から
export function Movies(props: { id: string | null }) {
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [data, setData] = useState<SeatRecordsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(readPageSize);
  const [panelW, setPanelW] = useState(readPanelWidth);
  const splitRef = useRef<HTMLDivElement>(null);
  // 古い読み込みの結果で、新しい絞り込みを上書きしない
  const seq = useRef(0);

  async function load(f: Filter) {
    const my = ++seq.current;
    try {
      const res = await getSeatRecords({ q: f.q, venue: f.venue, from: f.from, to: f.to, min_work_rating: f.minRating, limit: pageSize, offset: (page - 1) * pageSize });
      if (my !== seq.current) return;
      if (res.ok) {
        setData(res);
        setLoadError(null);
      } else setLoadError(errorText(res.errors));
    } catch (e) {
      if (my === seq.current) setLoadError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(filter), filter.q === "" ? 0 : 300);
    return () => clearTimeout(t);
  }, [filter, page, pageSize]);

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };
  const set = <K extends keyof Filter>(key: K, value: Filter[K]) => changeFilter({ ...filter, [key]: value });
  const filtered = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);
  const facets = data?.facets ?? { venues: [], years: [] };

  const records = data?.records ?? [];
  const at = props.id === null ? -1 : records.findIndex((r) => r.id === props.id);
  const prevId = at > 0 ? records[at - 1]!.id : null;
  const nextId = at >= 0 && at < records.length - 1 ? records[at + 1]!.id : null;
  const open = (id: string | null) => navigate(id === null ? "/movies" : `/movies/${encodeURIComponent(id)}`, { keepScroll: true });

  // シートを開いている間は、ページ全体の「引き下げて更新」を止める
  useEffect(() => {
    if (props.id === null) return;
    const prev = document.documentElement.style.overscrollBehaviorY;
    document.documentElement.style.overscrollBehaviorY = "contain";
    return () => {
      document.documentElement.style.overscrollBehaviorY = prev;
    };
  }, [props.id === null]);

  return (
    <section class={`page cat books${props.id !== null ? " has-panel" : ""}`}>
      <header class="cat__header">
        <h1 class="cat__title">映画</h1>
        <p class="cat__lead">見た映画の記録です(座席の記録を、ポスターで並べています)。登録は、AI に頼みます。</p>
      </header>

      <div class="books__bar">
        <input type="search" class="books__q" placeholder="作品名・映画館・一言で探す" value={filter.q} onInput={(e) => set("q", e.currentTarget.value)} aria-label="言葉で探す" />
      </div>

      <div class="books__tools">
        <button type="button" class={`books__tool${showFilter || filtered ? " is-on" : ""}`} aria-expanded={showFilter} onClick={() => setShowFilter((v) => !v)}>
          絞り込み{filtered ? "(あり)" : ""} {showFilter ? "▴" : "▾"}
        </button>
        <button type="button" class={`books__tool${filter.minRating === 4 ? " is-on" : ""}`} aria-pressed={filter.minRating === 4} onClick={() => set("minRating", filter.minRating === 4 ? 0 : 4)}>
          作品★4以上
        </button>
        {facets.years.map((y) => (
          <button
            type="button"
            key={y}
            class={`books__tool${isYearSelected(filter.from, filter.to, y) ? " is-on" : ""}`}
            aria-pressed={isYearSelected(filter.from, filter.to, y)}
            onClick={() => changeFilter({ ...filter, ...(isYearSelected(filter.from, filter.to, y) ? { from: "", to: "" } : yearRange(y)) })}
          >
            {y}年
          </button>
        ))}
      </div>

      {showFilter && (
        <section class="cat__card books__filter" aria-label="絞り込み">
          <div class="books__row">
            <label class="books__field">
              映画館・会場
              <select value={filter.venue} onChange={(e) => set("venue", e.currentTarget.value)}>
                <option value="">すべて</option>
                {facets.venues.map((v) => (
                  <option value={v} key={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label class="books__field">
              見た日(から)
              <input type="date" value={filter.from} onInput={(e) => set("from", e.currentTarget.value)} />
            </label>
            <label class="books__field">
              見た日(まで)
              <input type="date" value={filter.to} onInput={(e) => set("to", e.currentTarget.value)} />
            </label>
          </div>
          {filtered && (
            <button type="button" class="cat__link books__clear" onClick={() => changeFilter(NO_FILTER)}>
              絞り込みをやめる
            </button>
          )}
        </section>
      )}

      {loadError && (
        <p class="error" role="alert">
          {loadError}
        </p>
      )}
      {data && (
        <div class="books__countbar">
          <p class="muted books__count">{movieCountText(data.count)}</p>
          <label class="books__size">
            1ページ
            <select
              value={pageSize}
              onChange={(e) => {
                const n = Number(e.currentTarget.value);
                savePageSize(n);
                setPageSize(n);
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option value={n} key={n}>
                  {n}件
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {data && data.records.length === 0 && !filtered && <p class="muted">まだ記録がありません。AI に「今日の映画の席を記録して」と頼んでください。</p>}

      <div class="books__split" ref={splitRef} style={{ "--panel-w": `${panelW}px` }}>
        <div class="books__listcol">
          <ul class="books__grid">
            {records.map((r) => (
              <li key={r.id}>
                <Link href={`/movies/${encodeURIComponent(r.id)}`} class={`books__tile${r.id === props.id ? " is-selected" : ""}`} aria-current={r.id === props.id ? "page" : undefined} keepScroll>
                  <BookCover title={r.title ?? r.venue} isbn={null} coverUrl={r.poster_url} />
                  <span class="books__tile-title">{movieHeading(r)}</span>
                  <span class="books__tile-author">{r.date}</span>
                  {r.work_rating !== null && <span class="movie__stars">{ratingStars(r.work_rating)}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {data && data.count > pageSize && <Pager page={page} pages={pageCountOf(data.count, pageSize)} onPage={setPage} />}
        </div>
        {props.id !== null && (
          <>
            <div class="books__backdrop" onClick={() => open(null)} />
            <aside class="books__panel" aria-label="映画の詳細" onPointerDown={sheetSwipe(() => open(null))}>
              <div class="books__grab" aria-hidden="true" />
              <div
                class="books__resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="詳細の幅を変える"
                onPointerDown={(e) => {
                  const el = e.currentTarget;
                  el.setPointerCapture(e.pointerId);
                  const move = (ev: PointerEvent) => {
                    const r = splitRef.current?.getBoundingClientRect();
                    if (r) setPanelW(clampPanelWidth(r.right - ev.clientX, r.width));
                  };
                  const up = () => {
                    el.removeEventListener("pointermove", move);
                    el.removeEventListener("pointerup", up);
                    setPanelW((w) => (savePanelWidth(w), w));
                  };
                  el.addEventListener("pointermove", move);
                  el.addEventListener("pointerup", up);
                }}
              />
              <MovieDetail id={props.id} prevId={prevId} nextId={nextId} onOpen={open} />
            </aside>
          </>
        )}
      </div>
    </section>
  );
}

function MovieDetail(props: { id: string; prevId: string | null; nextId: string | null; onOpen: (id: string | null) => void }) {
  const [rec, setRec] = useState<SeatRecordView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRec(null);
    getSeatRecord(props.id)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setRec(res.seat_record);
          setError(null);
        } else setError(errorText(res.errors));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込めませんでした。");
      });
    return () => {
      cancelled = true;
    };
  }, [props.id]);

  // Esc で閉じる、左右の矢印で前後へ(入力中は除く)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Escape") props.onOpen(null);
      else if (e.key === "ArrowLeft" && props.prevId) props.onOpen(props.prevId);
      else if (e.key === "ArrowRight" && props.nextId) props.onOpen(props.nextId);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.prevId, props.nextId]);

  return (
    <div class="bookp">
      <div class="bookp__bar">
        <button type="button" class="bookp__nav" aria-label="前の映画" disabled={!props.prevId} onClick={() => props.prevId && props.onOpen(props.prevId)}>
          ‹
        </button>
        <button type="button" class="bookp__nav" aria-label="次の映画" disabled={!props.nextId} onClick={() => props.nextId && props.onOpen(props.nextId)}>
          ›
        </button>
        <span class="bookp__space" />
        <button type="button" class="bookp__nav" aria-label="閉じる" onClick={() => props.onOpen(null)}>
          ×
        </button>
      </div>
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {rec && (
        <article class="bookd">
          <div class="bookd__cover">
            <BookCover title={rec.title ?? rec.venue} isbn={null} coverUrl={rec.poster_url} />
          </div>
          <div class="bookd__info">
            <div class="bookd__head">
              <h1 class="bookd__title">{movieHeading(rec)}</h1>
              {rec.work_rating !== null && <p class="bookd__author movie__stars">{ratingStars(rec.work_rating)}</p>}
            </div>
            <dl class="bookd__table">
              <dt>見た日</dt>
              <dd>{rec.date}</dd>
              <dt>映画館・会場</dt>
              <dd>{rec.venue}</dd>
              {seatText(rec) && (
                <>
                  <dt>座席</dt>
                  <dd>{seatText(rec)}</dd>
                </>
              )}
              {rec.rating !== null && (
                <>
                  <dt>席の評価</dt>
                  <dd>
                    <SeatChairs value={rec.rating} />
                  </dd>
                </>
              )}
              {rec.screen_note && (
                <>
                  <dt>スクリーンの特徴</dt>
                  <dd>{rec.screen_note}</dd>
                </>
              )}
              {rec.note && (
                <>
                  <dt>一言</dt>
                  <dd>{rec.note}</dd>
                </>
              )}
              {rec.transaction_id && (
                <>
                  <dt>レシート</dt>
                  <dd>
                    <Link href={`/tx/${encodeURIComponent(rec.transaction_id)}`}>レシートを見る ›</Link>
                  </dd>
                </>
              )}
              <dt>その日</dt>
              <dd>
                <Link href={`/day/${rec.date}`}>この日の記録を開く(直すときはここ) ›</Link>
              </dd>
            </dl>
          </div>
        </article>
      )}
    </div>
  );
}
