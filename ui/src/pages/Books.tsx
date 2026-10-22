import { useEffect, useRef, useState } from "preact/hooks";
import type { BookView, BooksData } from "../../../src/api/contract";
import { addBook, deleteBook, getBook, getBooks, setFavoriteSeries, updateBook } from "../api";
import { BookCover } from "../components/BookCover";
import { Link, navigate } from "../router";
import { errorText } from "./categoriesLogic";
import { BOOK_STATUS_OPTIONS, PAGE_SIZES, bookHeading, checkForm, countText, EMPTY_FORM, formFromBook, isbnText, newBookFrom, clampPanelWidth, isYearSelected, pageCountOf, patchFrom, statusLabel, yearRange, type BookForm } from "./booksLogic";
import { readPageSize, readPanelWidth, savePageSize, savePanelWidth } from "./booksStorage";
import "./Categories.css";
import "./Books.css";

interface Filter {
  q: string;
  series: string;
  author: string;
  buyer: string;
  status: string;
  from: string;
  to: string;
  unlinked: boolean;
  favorite: boolean;
}
const NO_FILTER: Filter = { q: "", series: "", author: "", buyer: "", status: "owned", from: "", to: "", unlinked: false, favorite: false };

// 買った本の記録。一覧(カバーの並び)と、1冊の詳細(/books/:id)。タイトルなどをネットで調べて入れるのは、AI(MCP)に頼む
export function Books(props: { id: string | null }) {
  return <BookList selectedId={props.id} />;
}

// 変更を1件ずつ実行する(二重送信を防ぐ)
function useAct() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  async function act<T extends { message: string }>(call: () => Promise<({ ok: true } & T) | { ok: false; errors: { message: string }[] }>, onOk: (res: T) => Promise<void> | void): Promise<string | null> {
    if (busyRef.current) return "処理中です。少し待ってください。";
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await call();
      if (!res.ok) return errorText(res.errors);
      await onOk(res);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "通信に失敗しました。";
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return { act, busy };
}

function BookList(props: { selectedId: string | null }) {
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [data, setData] = useState<BooksData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [panelW, setPanelW] = useState(readPanelWidth);
  const splitRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(readPageSize);
  const { act, busy } = useAct();
  // 古い読み込みの結果で、新しい絞り込みを上書きしない
  const seq = useRef(0);

  async function load(f: Filter, p = page, size = pageSize) {
    const my = ++seq.current;
    try {
      const res = await getBooks({ ...f, limit: size, offset: (p - 1) * size });
      if (my !== seq.current) return;
      if (res.ok) {
        setData(res);
        setLoadError(null);
      } else setLoadError(errorText(res.errors));
    } catch (e) {
      if (my === seq.current) setLoadError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }

  // 言葉の入力は、打ち終わってから読み直す
  useEffect(() => {
    const t = setTimeout(() => void load(filter), filter.q === "" ? 0 : 300);
    return () => clearTimeout(t);
  }, [filter, page, pageSize]);

  // 絞り込みを変えたら、1ページ目に戻る
  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  const set = <K extends keyof Filter>(key: K, value: Filter[K]) => changeFilter({ ...filter, [key]: value });
  const filtered = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);
  const facets = data?.facets ?? { series: [], authors: [], buyers: [], favorite_series: [], years: [] };

  // シートを開いている間は、ページ全体の「引き下げて更新」を止める
  useEffect(() => {
    if (props.selectedId === null) return;
    const prev = document.documentElement.style.overscrollBehaviorY;
    document.documentElement.style.overscrollBehaviorY = "contain";
    return () => {
      document.documentElement.style.overscrollBehaviorY = prev;
    };
  }, [props.selectedId === null]);

  // 開いている本の、前と次(いま出ている一覧の並びで)
  const records = data?.records ?? [];
  const at = props.selectedId === null ? -1 : records.findIndex((b) => b.id === props.selectedId);
  const prevId = at > 0 ? records[at - 1]!.id : null;
  const nextId = at >= 0 && at < records.length - 1 ? records[at + 1]!.id : null;
  const open = (id: string | null) => navigate(id === null ? "/books" : `/books/${encodeURIComponent(id)}`, { keepScroll: true });

  return (
    <section class={`page cat books${props.selectedId !== null ? " has-panel" : ""}`}>
      <header class="cat__header">
        <h1 class="cat__title">本</h1>
        <p class="cat__lead">買った本の記録です。ISBN を AI に伝えると、ネットで調べて登録してくれます。</p>
      </header>

      {notice && (
        <p class="cat__notice" role="status">
          {notice}
        </p>
      )}

      <div class="books__bar">
        <input type="search" class="books__q" placeholder="タイトル・著者・ISBN で探す" value={filter.q} onInput={(e) => set("q", e.currentTarget.value)} aria-label="言葉で探す" />
        <button type="button" class="btn btn--primary" onClick={() => setAdding(true)}>
          ＋ 本を追加
        </button>
      </div>

      <div class="books__tools">
        <button type="button" class={`books__tool${showFilter || filtered ? " is-on" : ""}`} aria-expanded={showFilter} onClick={() => setShowFilter((v) => !v)}>
          絞り込み{filtered ? "(あり)" : ""} {showFilter ? "▴" : "▾"}
        </button>
        <button type="button" class={`books__tool${filter.status !== "owned" ? " is-on" : ""}`} aria-pressed={filter.status !== "owned"} onClick={() => set("status", filter.status === "owned" ? "" : "owned")}>
          手放した本も表示
        </button>
        <button type="button" class={`books__tool${filter.favorite ? " is-on" : ""}`} aria-pressed={filter.favorite} onClick={() => set("favorite", !filter.favorite)}>
          ♥ お気に入りシリーズ
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
            <FilterSelect label="シリーズ" value={filter.series} options={facets.series} onChange={(v) => set("series", v)} />
            <FilterSelect label="著者" value={filter.author} options={facets.authors} onChange={(v) => set("author", v)} />
            <FilterSelect label="購入者" value={filter.buyer} options={facets.buyers} onChange={(v) => set("buyer", v)} />
          </div>
          <div class="books__row">
            <label class="books__field">
              買った日(から)
              <input type="date" value={filter.from} onInput={(e) => set("from", e.currentTarget.value)} />
            </label>
            <label class="books__field">
              買った日(まで)
              <input type="date" value={filter.to} onInput={(e) => set("to", e.currentTarget.value)} />
            </label>
            <label class="books__check">
              <input type="checkbox" checked={filter.unlinked} onChange={(e) => set("unlinked", e.currentTarget.checked)} />
              レシートに紐づいていない本だけ
            </label>
          </div>
          {filtered && (
            <button type="button" class="cat__link books__clear" onClick={() => changeFilter(NO_FILTER)}>
              絞り込みをやめる
            </button>
          )}
        </section>
      )}

      {adding && (
        <BookFormCard
          title="本を追加"
          initial={EMPTY_FORM}
          submitLabel="追加する"
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(f) =>
            act(
              () => addBook(newBookFrom(f)),
              async (res) => {
                setNotice(res.message);
                setAdding(false);
                await load(filter);
              },
            )
          }
        />
      )}

      {loadError && (
        <p class="error" role="alert">
          {loadError}
        </p>
      )}
      {data && (
        <div class="books__countbar">
          <p class="muted books__count">{countText(data.count)}</p>
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
                  {n}冊
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {data && filter.status === "owned" && data.hidden_released > 0 && (
        <p class="muted books__hidden">
          手放した本が{data.hidden_released}冊あります(いまは表示していません)。
          <button type="button" class="cat__link" onClick={() => set("status", "")}>
            表示する
          </button>
        </p>
      )}
      {data && data.records.length === 0 && !filtered && <p class="muted">まだ本の記録がありません。「＋ 本を追加」か、AI に「この本を記録して」と頼んでください。</p>}

      <div class="books__split" ref={splitRef} style={{ "--panel-w": `${panelW}px` }}>
      <div class="books__listcol">
      <ul class="books__grid">
        {data?.records.map((b) => (
          <li key={b.id}>
            <Link href={`/books/${encodeURIComponent(b.id)}`} class={`books__tile${b.id === props.selectedId ? " is-selected" : ""}`} keepScroll aria-current={b.id === props.selectedId ? "page" : undefined}>
              <BookCover title={b.title} isbn={b.isbn} coverUrl={b.cover_url} status={b.status} favorite={b.series_favorite} />
              <span class="books__tile-title">{bookHeading(b)}</span>
              {b.author && <span class="books__tile-author">{b.author}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {data && data.count > pageSize && <Pager page={page} pages={pageCountOf(data.count, pageSize)} onPage={setPage} />}
      </div>
      {props.selectedId !== null && (
        <>
          <div class="books__backdrop" onClick={() => open(null)} />
          <aside class="books__panel" aria-label="本の詳細" onPointerDown={sheetSwipe(() => open(null))}>
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
                  const r = splitRef.current?.getBoundingClientRect();
                  if (r) setPanelW((w) => (savePanelWidth(w), w));
                };
                el.addEventListener("pointermove", move);
                el.addEventListener("pointerup", up);
              }}
            />
            <BookDetail id={props.selectedId} prevId={prevId} nextId={nextId} onOpen={open} onChanged={() => load(filter)} />
          </aside>
        </>
      )}
      </div>
    </section>
  );
}

// スマホ幅の下からのシート: 上の持ち手と ‹ › の行を、下へ引くと閉じる(一定以上引いたら閉じ、足りなければ戻る)
function sheetSwipe(close: () => void) {
  return (e: PointerEvent) => {
    if (!window.matchMedia("(max-width: 899px)").matches) return;
    const el = e.currentTarget as HTMLElement;
    const t = e.target as HTMLElement;
    if (!t.closest(".books__grab, .bookp__bar") || t.closest("button")) return;
    const startY = e.clientY;
    let dy = 0;
    el.setPointerCapture(e.pointerId);
    el.style.transition = "none";
    const move = (ev: PointerEvent) => {
      dy = Math.max(0, ev.clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.style.transition = "transform 0.18s";
      if (dy > 110) close();
      el.style.transform = "";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
}

function Pager(props: { page: number; pages: number; onPage: (p: number) => void }) {
  const go = (p: number) => {
    props.onPage(p);
    window.scrollTo({ top: 0 });
  };
  return (
    <nav class="books__pager" aria-label="ページ送り">
      {props.page > 1 ? (
        <button type="button" class="btn" onClick={() => go(props.page - 1)}>
          ‹ 前へ
        </button>
      ) : (
        <span />
      )}
      <span class="muted">
        {props.page} / {props.pages}ページ
      </span>
      {props.page < props.pages ? (
        <button type="button" class="btn" onClick={() => go(props.page + 1)}>
          次へ ›
        </button>
      ) : (
        <span />
      )}
    </nav>
  );
}

function BookDetail(props: { id: string; prevId: string | null; nextId: string | null; onOpen: (id: string | null) => void; onChanged: () => void }) {
  const [book, setBook] = useState<BookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { act, busy } = useAct();

  async function load() {
    try {
      const res = await getBook(props.id);
      if (res.ok) {
        setBook(res.book);
        setError(null);
      } else setError(errorText(res.errors));
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }
  useEffect(() => {
    setBook(null);
    setEditing(false);
    void load();
  }, [props.id]);

  // Esc で閉じる、左右の矢印で前後の本へ(入力中は除く)
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
        <button type="button" class="bookp__nav" aria-label="前の本" disabled={!props.prevId} onClick={() => props.prevId && props.onOpen(props.prevId)}>
          ‹
        </button>
        <button type="button" class="bookp__nav" aria-label="次の本" disabled={!props.nextId} onClick={() => props.nextId && props.onOpen(props.nextId)}>
          ›
        </button>
        <span class="bookp__space" />
        <button type="button" class="bookp__nav" aria-label="閉じる" onClick={() => props.onOpen(null)}>
          ×
        </button>
      </div>
      {notice && (
        <p class="cat__notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {book && editing && (
        <BookFormCard
          title="本を直す"
          initial={formFromBook(book)}
          submitLabel="保存する"
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(f) => {
            const patch = patchFrom(formFromBook(book), f);
            if (Object.keys(patch).length === 0) return Promise.resolve("変えた項目がありません。");
            return act(
              () => updateBook(book.id, patch),
              async (res) => {
                setNotice(res.message);
                setEditing(false);
                setBook(res.book);
                props.onChanged();
              },
            );
          }}
        />
      )}
      {book && !editing && (
        <article class="bookd">
          <div class="bookd__cover">
            <BookCover title={book.title} isbn={book.isbn} coverUrl={book.cover_url} status={book.status} />
          </div>
          <div class="bookd__info">
            <div class="bookd__head">
              <h1 class="bookd__title">{bookHeading(book)}</h1>
              {book.author && <p class="bookd__author">{book.author}</p>}
            </div>
            <dl class="bookd__table">
              {book.status !== "owned" && <Row label="状況" value={statusLabel(book.status)} />}
              {book.released_on && <Row label="手放した日" value={book.released_on} />}
              {book.series && (
                <>
                  <dt>シリーズ</dt>
                  <dd class="bookd__series">
                    <span>{book.series}</span>
                    <button
                      type="button"
                      class={`bookd__heart${book.series_favorite ? " is-on" : ""}`}
                      aria-pressed={book.series_favorite}
                      aria-label={book.series_favorite ? "お気に入りシリーズから外す" : "お気に入りシリーズに入れる"}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => setFavoriteSeries(book.series!, !book.series_favorite),
                          async (res) => {
                            setNotice(res.message);
                            await load();
                            props.onChanged();
                          },
                        ).then((e) => e && setError(e))
                      }
                    >
                      {book.series_favorite ? "♥" : "♡"}
                    </button>
                  </dd>
                </>
              )}
              {book.purchased_on && <Row label="買った日" value={book.purchased_on} />}
              {book.buyer && <Row label="購入者" value={book.buyer} />}
              {book.isbn && <Row label="ISBN" value={isbnText(book.isbn)} />}
              {book.note && <Row label="メモ" value={book.note} />}
              {book.transaction_id && (
                <>
                  <dt>レシート</dt>
                  <dd>
                    <Link href={`/tx/${encodeURIComponent(book.transaction_id)}`}>レシートを見る ›</Link>
                  </dd>
                </>
              )}
            </dl>
            <div class="bookd__actions">
              <button type="button" class="cat__link" onClick={() => setEditing(true)}>
                直す
              </button>
              <button
                type="button"
                class="cat__link books__delete"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`「${bookHeading(book)}」の記録を削除しますか?(レシートの記録は消えません)`)) return;
                  void act(
                    () => deleteBook(book.id),
                    () => {
                      props.onChanged();
                      props.onOpen(null);
                    },
                  ).then((e) => e && setError(e));
                }}
              >
                削除
              </button>
            </div>
          </div>
        </article>
      )}
    </div>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  );
}

function FilterSelect(props: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label class="books__field">
      {props.label}
      <select value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
        <option value="">すべて</option>
        {props.options.map((o) => (
          <option value={o} key={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function BookFormCard(props: { title: string; initial: BookForm; submitLabel: string; busy: boolean; onCancel: () => void; onSubmit: (f: BookForm) => Promise<string | null> }) {
  const [f, setF] = useState<BookForm>(props.initial);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const set = (key: keyof BookForm) => (e: Event) => setF((cur) => ({ ...cur, [key]: (e.currentTarget as HTMLInputElement).value }));

  async function submit(e: Event) {
    e.preventDefault();
    const bad = checkForm(f);
    if (bad) return setError(bad);
    setError(await props.onSubmit(f));
  }

  return (
    <form class="cat__card cat__form" onSubmit={submit}>
      <h2 class="cat__group">{props.title}</h2>
      <label>
        ISBN(10桁か13桁。ハイフンはあってもなくても)
        <input ref={first} value={f.isbn} onInput={set("isbn")} inputMode="numeric" maxLength={20} />
      </label>
      <label>
        タイトル
        <input value={f.title} onInput={set("title")} maxLength={200} />
      </label>
      <label>
        著者
        <input value={f.author} onInput={set("author")} maxLength={100} />
      </label>
      <label>
        シリーズ
        <input value={f.series} onInput={set("series")} maxLength={100} />
      </label>
      <label>
        購入者
        <input value={f.buyer} onInput={set("buyer")} maxLength={50} />
      </label>
      <label>
        買った日(レシートに紐づいていれば、空でもその日になります)
        <input type="date" value={f.purchased_on} onInput={set("purchased_on")} />
      </label>
      <label>
        カバー画像のURL(https。なくてもよい)
        <input value={f.cover_url} onInput={set("cover_url")} inputMode="url" maxLength={500} />
      </label>
      <label>
        手元の状況
        <select value={f.status} onChange={(e) => setF((cur) => ({ ...cur, status: e.currentTarget.value as BookForm["status"] }))}>
          {BOOK_STATUS_OPTIONS.map((o) => (
            <option value={o.value} key={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {f.status !== "owned" && (
        <label>
          手放した日(わからなければ空でもよい)
          <input type="date" value={f.released_on} onInput={set("released_on")} />
        </label>
      )}
      <label>
        メモ(売った金額や、渡した相手など。金額は記録しません)
        <input value={f.note} onInput={set("note")} maxLength={500} />
      </label>
      {error && (
        <p class="error cat__error" role="alert">
          {error}
        </p>
      )}
      <div class="cat__actions">
        <button type="submit" class="btn btn--primary" disabled={props.busy}>
          {props.submitLabel}
        </button>
        <button type="button" class="btn" onClick={props.onCancel} disabled={props.busy}>
          やめる
        </button>
      </div>
    </form>
  );
}
