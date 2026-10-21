import { useEffect, useRef, useState } from "preact/hooks";
import type { BookView, BooksData } from "../../../src/api/contract";
import { addBook, deleteBook, getBooks, updateBook } from "../api";
import { Link } from "../router";
import { errorText } from "./categoriesLogic";
import { checkForm, countText, EMPTY_FORM, formFromBook, isbnText, newBookFrom, patchFrom, type BookForm } from "./booksLogic";
import "./Categories.css";
import "./Books.css";

interface Filter {
  q: string;
  series: string;
  author: string;
  buyer: string;
  from: string;
  to: string;
  unlinked: boolean;
}
const NO_FILTER: Filter = { q: "", series: "", author: "", buyer: "", from: "", to: "", unlinked: false };

// いま開いているフォーム(同時に1つだけ)
type Mode = { kind: "none" } | { kind: "add" } | { kind: "edit"; book: BookView };

// 買った本の記録。一覧・絞り込み・追加・直す・消す。タイトルなどをネットで調べて入れるのは、AI(MCP)に頼む
export function Books() {
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [data, setData] = useState<BooksData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // 古い読み込みの結果で、新しい絞り込みを上書きしない
  const seq = useRef(0);

  async function load(f: Filter) {
    const my = ++seq.current;
    try {
      const res = await getBooks({ ...f, limit: 200 });
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
  }, [filter]);

  async function act<T extends { message: string }>(call: () => Promise<{ ok: true } & T | { ok: false; errors: { message: string }[] }>): Promise<string | null> {
    if (busyRef.current) return "処理中です。少し待ってください。";
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const res = await call();
      if (!res.ok) return errorText(res.errors);
      setNotice(res.message);
      setMode({ kind: "none" });
      await load(filter);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "通信に失敗しました。";
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const set = <K extends keyof Filter>(key: K, value: Filter[K]) => setFilter((f) => ({ ...f, [key]: value }));
  const filtered = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);
  const facets = data?.facets ?? { series: [], authors: [], buyers: [] };

  return (
    <section class="page cat books">
      <header class="cat__header">
        <h1 class="cat__title">本</h1>
        <p class="cat__lead">買った本の記録です。ISBN だけをAI(Claude など)に伝えると、タイトル・著者・シリーズをネットで調べて登録してくれます。レシートに紐づけると、買った日が自動で入ります。</p>
      </header>

      {notice && (
        <p class="cat__notice" role="status">
          {notice}
        </p>
      )}

      <section class="cat__card books__filter" aria-label="絞り込み">
        <input type="search" class="books__q" placeholder="タイトル・著者・シリーズ・メモ・ISBN で探す" value={filter.q} onInput={(e) => set("q", e.currentTarget.value)} aria-label="言葉で探す" />
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
          <button type="button" class="cat__link books__clear" onClick={() => setFilter(NO_FILTER)}>
            絞り込みをやめる
          </button>
        )}
      </section>

      {mode.kind === "add" ? (
        <BookFormCard title="本を追加" initial={EMPTY_FORM} submitLabel="追加する" busy={busy} onCancel={() => setMode({ kind: "none" })} onSubmit={(f) => act(() => addBook(newBookFrom(f)))} />
      ) : (
        <button type="button" class="cat__add" onClick={() => setMode({ kind: "add" })}>
          ＋ 本を追加
        </button>
      )}

      {loadError && (
        <p class="error" role="alert">
          {loadError}
        </p>
      )}
      {data && <p class="muted books__count">{countText(data.count, data.records.length)}</p>}
      {data && data.records.length === 0 && !filtered && <p class="muted">まだ本の記録がありません。「＋ 本を追加」か、AI に「この本を記録して」と頼んでください。</p>}

      <ul class="books__list">
        {data?.records.map((b) =>
          mode.kind === "edit" && mode.book.id === b.id ? (
            <li key={b.id}>
              <BookFormCard
                title="本を直す"
                initial={formFromBook(b)}
                submitLabel="保存する"
                busy={busy}
                onCancel={() => setMode({ kind: "none" })}
                onSubmit={(f) => {
                  const patch = patchFrom(formFromBook(b), f);
                  if (Object.keys(patch).length === 0) return Promise.resolve("変えた項目がありません。");
                  return act(() => updateBook(b.id, patch));
                }}
              />
            </li>
          ) : (
            <li key={b.id} class="cat__card books__item">
              <div class="books__main">
                <strong class="books__title">{b.title ?? `ISBN ${isbnText(b.isbn)}`}</strong>
                <p class="books__meta">
                  {[b.author, b.series && `シリーズ: ${b.series}`, b.buyer && `購入者: ${b.buyer}`, b.purchased_on && `買った日: ${b.purchased_on}`].filter(Boolean).join(" ・ ")}
                </p>
                {b.title && b.isbn && <p class="books__meta">ISBN {isbnText(b.isbn)}</p>}
                {b.note && <p class="books__note">{b.note}</p>}
                {b.transaction_id && (
                  <Link href={`/tx/${encodeURIComponent(b.transaction_id)}`} class="books__receipt">
                    レシートを見る
                  </Link>
                )}
              </div>
              <div class="books__actions">
                <button type="button" class="cat__link" onClick={() => setMode({ kind: "edit", book: b })}>
                  直す
                </button>
                <button
                  type="button"
                  class="cat__link books__delete"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`「${b.title ?? isbnText(b.isbn)}」の記録を削除しますか?(レシートの記録は消えません)`)) void act(() => deleteBook(b.id));
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
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
        メモ
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
