import { useEffect, useRef, useState } from "preact/hooks";
import type { SearchData, SearchHitType } from "../../../src/api/contract";
import { searchRecords } from "../api";
import { formatYen } from "../format";
import { Link, navigate } from "../router";
import { errorText } from "./categoriesLogic";
import { TYPE_LABELS, TYPE_OPTIONS, dateHeading, groupHitsByDate, hitHref, rangeLabel, searchApiPath, searchPageCount, searchPageHref } from "./searchLogic";
import "./Categories.css";
import "./Search.css";

// 記録の横断検索。「映画に行ったのはいつ?」「皮膚科に最後に行ったのは?」に答える
export function Search(props: { q: string; type: SearchHitType | null; page: number }) {
  const [text, setText] = useState(props.q);
  const [type, setType] = useState<SearchHitType | "">(props.type ?? "");
  const [data, setData] = useState<SearchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const inputId = useRef(`sq-${Math.random().toString(36).slice(2, 8)}`).current;

  // URL(検索の言葉・対象)が変わったら、入力欄をそろえて検索し直す
  useEffect(() => {
    setText(props.q);
    setType(props.type ?? "");
    // 言葉も種類も空のときは、検索しない(種類だけなら、その種類の記録を新しい順に並べる)
    if (props.q === "" && props.type === null) {
      setData(null);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    searchRecords(searchApiPath(props.q, props.type, props.page))
      .then((res) => {
        if (mine !== seq.current) return;
        if (res.ok) {
          setData(res);
          setError(null);
        } else {
          setData(null);
          setError(errorText(res.errors));
        }
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setError(e instanceof Error ? e.message : "検索できませんでした。");
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [props.q, props.type, props.page]);

  const submit = (e: Event) => {
    e.preventDefault();
    navigate(searchPageHref(text, type === "" ? null : type));
  };

  // 対象のチップは、押したらすぐ検索し直す(言葉が空なら、その種類の記録を新しい順に並べる)
  const pickType = (value: SearchHitType | "") => {
    setType(value);
    navigate(searchPageHref(text, value === "" ? null : value));
  };

  const groups = data ? groupHitsByDate(data.hits) : [];

  return (
    <section class="page cat search" aria-labelledby="search-title">
      <header class="cat__header">
        <h1 id="search-title" class="cat__title">
          検索
        </h1>
        <p class="cat__lead">店名・メモ・出来事・映画の題名・リンクなどから、過去の記録を探します。空白で区切ると、すべてを含むものに絞ります。</p>
      </header>

      <form class="search__form" role="search" onSubmit={submit}>
        <label class="search__label" for={inputId}>
          探す言葉(例: 映画、皮膚科、キャンプ)
        </label>
        <div class="search__row">
          <input id={inputId} class="search__input" type="search" maxLength={200} value={text} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
          <button type="submit" class="btn btn--primary" disabled={text.trim() === "" && type === ""}>
            検索
          </button>
        </div>
        <div class="search__types" role="group" aria-label="探す対象">
          {TYPE_OPTIONS.map((o) => (
            <button key={o.value} type="button" class={`search__chip${type === o.value ? " is-on" : ""}`} aria-pressed={type === o.value} onClick={() => pickType(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      </form>

      {props.q === "" && props.type === null && (
        <p class="muted search__hint">言葉を入れて「検索」を押すか、上の種類(支出・出来事・映画・座席・リンク・写真)を押すと、その種類の記録が新しい日付順に並びます。</p>
      )}

      {loading && (
        <p class="muted cat__status" role="status">
          検索中です…
        </p>
      )}
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      {data && !loading && (
        <div class="search__result" aria-live="polite">
          {data.total === 0 ? (
            <p class="muted">{props.page > 1 ? "このページに記録はありません。" : data.query === "" ? "この種類の記録は、まだありません。" : `「${data.query}」に当てはまる記録はありません。別の言葉(短い言葉・漢字とひらがなの違いなど)でも試してください。`}</p>
          ) : (
            <>
              <p class="search__summary">
                <strong>{data.total}件</strong>見つかりました。いちばん新しいのは
                {data.latest_date && <Link href={`/day/${data.latest_date}`}>{dateHeading(data.latest_date)}</Link>}です。
                {data.total > data.count && <span class="muted">({rangeLabel(data.offset, data.count, data.total)}を新しい順に表示)</span>}
              </p>
              {groups.map((g) => (
                <div key={g.date} class="search__group">
                  <h2 class="search__date">
                    <Link href={`/day/${g.date}`}>{dateHeading(g.date)}</Link>
                  </h2>
                  <ul class="search__list">
                    {g.hits.map((h) => (
                      <li key={`${h.type}-${h.id}`} class="search__hit">
                        <span class="search__badge">{TYPE_LABELS[h.type]}</span>
                        <Link href={hitHref(h)} class="search__main">
                          <span class="search__title">{h.title}</span>
                          {h.detail && <span class="search__detail muted">{h.detail}</span>}
                        </Link>
                        {h.amount !== null && <span class="search__amount">{formatYen(h.amount)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {(props.page > 1 || data.has_more) && (
                <nav class="search__pager" aria-label="ページ送り">
                  {props.page > 1 ? <Link href={searchPageHref(props.q, props.type, props.page - 1)} class="btn">‹ 前へ(新しい記録)</Link> : <span />}
                  <span class="muted">{props.page} / {searchPageCount(data.total)}ページ</span>
                  {data.has_more ? <Link href={searchPageHref(props.q, props.type, props.page + 1)} class="btn">次へ(古い記録) ›</Link> : <span />}
                </nav>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
