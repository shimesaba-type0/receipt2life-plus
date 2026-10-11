import { useEffect, useState } from "preact/hooks";
import type { HomeData } from "../../../src/api/contract";
import { getHome } from "../api";
import { formatDateJa, formatMonthJa, formatYen, todayJst } from "../format";
import { Link } from "../router";
import { barSegments, formatPercent, groupColor, isEmptyHome, memoView, recentTitle, reviewHref, reviewLabel, shortDate } from "./homeLogic";
import "./Home.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: HomeData };

export function Home() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getHome()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setState({ kind: "ready", data: res });
        else setState({ kind: "error", message: res.errors[0]?.message ?? "読み込めませんでした。" });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : "読み込めませんでした。" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const today = state.kind === "ready" ? state.data.today.date : todayJst();

  return (
    <section class="page home">
      <header class="home__header">
        <div>
          <h1 class="home__title">receipt2life+</h1>
          <p class="home__date">{formatDateJa(today)}</p>
        </div>
        <a class="home__export" href="/export" download aria-label="データをエクスポートする">
          エクスポート
        </a>
      </header>

      {state.kind === "loading" && (
        <p class="home__status" role="status">
          読み込み中です…
        </p>
      )}
      {state.kind === "error" && (
        <div class="card home__status" role="alert">
          <p class="error">{state.message}</p>
          <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)}>
            もう一度読み込む
          </button>
        </div>
      )}
      {state.kind === "ready" && <HomeBody data={state.data} />}
    </section>
  );
}

function HomeBody(props: { data: HomeData }) {
  const { data } = props;
  const segments = barSegments(data.groups);
  const memo = memoView(data.memo);

  return (
    <>
      {isEmptyHome(data) && (
        <div class="card home__empty" role="status">
          <p class="home__empty-title">まだ記録がありません</p>
          <p class="muted">レシートを登録すると、ここに合計や内訳が表示されます。</p>
        </div>
      )}

      {data.needs_review > 0 && (
        <Link href={reviewHref(data)} class="home__review" aria-label={`${reviewLabel(data.needs_review)}。タップして確認する`}>
          <span class="home__review-count num">{data.needs_review}件</span>
          <span>要確認の支出があります</span>
          <span aria-hidden="true">›</span>
        </Link>
      )}

      <div class="card home__today">
        <h2 class="home__label">今日の合計</h2>
        <p class="home__big num" aria-label={`今日の合計 ${data.today.total}円`}>
          {formatYen(data.today.total)}
        </p>
        <p class="muted num">{data.today.count}件</p>
      </div>

      <div class="card">
        <h2 class="home__label">{formatMonthJa(data.month.month)}の合計</h2>
        <p class="home__mid num" aria-label={`今月の合計 ${data.month.total}円`}>
          {formatYen(data.month.total)}
        </p>
        <p class="muted num">{data.month.count}件</p>
      </div>

      <div class="card">
        <h2 class="home__label">大分類別の内訳</h2>
        {segments.length === 0 ? (
          <p class="muted">今月の支出はまだありません。</p>
        ) : (
          <>
            <div class="home__stack" role="img" aria-label={`大分類別の内訳: ${segments.map((s) => `${s.label} ${formatPercent(s.percent)}`).join("、")}`}>
              {segments.map((s) => (
                <span key={s.key} class="home__stack-seg" style={{ width: `${s.width}%`, background: s.color }} />
              ))}
            </div>
            <ul class="home__list">
              {data.groups.map((g, i) => (
                <li key={g.key} class="home__row">
                  <span class="home__swatch" style={{ background: groupColor(i) }} aria-hidden="true" />
                  <span class="home__row-name">{g.label}</span>
                  <span class="home__row-pct num">{formatPercent(g.percent)}</span>
                  <span class="home__row-amount num">{formatYen(g.total)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div class="card">
        <h2 class="home__label">メモ付き支出の割合</h2>
        <div class="home__meter" role="img" aria-label={memo.text}>
          <span class="home__meter-fill" style={{ width: `${memo.percent}%` }} />
        </div>
        <p class="muted num">{memo.text}</p>
      </div>

      <div class="card">
        <h2 class="home__label">最近の記録</h2>
        {data.recent.length === 0 ? (
          <p class="muted">最近の記録はありません。</p>
        ) : (
          <ul class="home__recent">
            {data.recent.map((t) => (
              <li key={t.id}>
                <Link href={`/day/${t.date}`} class="home__recent-link" aria-label={`${formatDateJa(t.date)} ${recentTitle(t)} ${t.amount}円。この日を開く`}>
                  <span class="home__recent-date num">{shortDate(t.date)}</span>
                  <span class="home__recent-title">
                    {recentTitle(t)}
                    {t.status === "needs_review" && <span class="chip chip--warn home__chip">要確認</span>}
                  </span>
                  <span class="home__recent-amount num">{formatYen(t.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
