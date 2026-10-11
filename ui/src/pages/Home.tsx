import { useEffect, useState } from "preact/hooks";
import type { CategoriesData, HomeData } from "../../../src/api/contract";
import { getCategories, getHome } from "../api";
import { CategoryIcon } from "../components/CategoryIcon";
import { chipIcon } from "../categoryIcons";
import { CATEGORY_ICON } from "../components/Nav";
import { formatDateJa, formatYen, todayJst } from "../format";
import { Link } from "../router";
import { barSegments, formatPercent, groupColor, isEmptyHome, memoView, monthRangeLabel, recentMerchant, recentSub, reviewHref, reviewLabel, shortDate } from "./homeLogic";
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

  // 最近の記録のカテゴリのアイコン用。読み込めなくても文字だけで表示を続ける
  const [cats, setCats] = useState<CategoriesData>({ categories: [], accounts: [] });
  useEffect(() => {
    getCategories()
      .then((res) => {
        if (res.ok) setCats(res);
      })
      .catch(() => undefined);
  }, []);

  const today = state.kind === "ready" ? state.data.today.date : todayJst();

  return (
    <section class="page home">
      <header class="home__header">
        <div class="home__heading">
          <span class="home__brand">receipt2life+</span>
          <span class="home__kicker">今日</span>
          <h1 class="home__date">{formatDateJa(today)}</h1>
        </div>
        {/* スマホだけ(PCは左メニューにある) */}
        <div class="home__tools">
          <Link href="/categories" class="home__export" aria-label="カテゴリ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              {CATEGORY_ICON.map((d) => (
                <path d={d} key={d} />
              ))}
            </svg>
          </Link>
          <Link href="/backup" class="home__export" aria-label="エクスポート">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4v11" />
              <path d="M7 11l5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
          </Link>
        </div>
        <Link href={`/day/${today}`} class="home__open-today">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          今日の記録を開く
        </Link>
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
      {state.kind === "ready" && <HomeBody data={state.data} cats={cats} />}
    </section>
  );
}

function HomeBody(props: { data: HomeData; cats: CategoriesData }) {
  const { data, cats } = props;
  const segments = barSegments(data.groups);
  const memo = memoView(data.memo);
  const range = monthRangeLabel(data.month.from, data.today.date);

  return (
    <>
      {isEmptyHome(data) && (
        <div class="card home__empty" role="status">
          <p class="home__empty-title">まだ記録がありません</p>
          <p class="muted">レシートを登録すると、ここに合計や内訳が表示されます。</p>
        </div>
      )}

      <div class="home__body">
        {data.needs_review > 0 && (
          <Link href={reviewHref(data)} class="home__review" aria-label={`${reviewLabel(data.needs_review)}。タップして確認する`}>
            <span>
              要確認の記録が <b class="num">{data.needs_review}件</b> あります
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        )}

        <section class="home__summary" aria-label="今日と今月の合計">
          <div class="home__today">
            <span class="home__label">
              今日<span class="home__pc-only">の支出</span>
            </span>
            <span class="home__big num" aria-label={`今日の合計 ${data.today.total}円`}>
              {formatYen(data.today.total)}
            </span>
            <span class="home__label num">{data.today.count}件の記録</span>
          </div>
          <div class="home__divider" />
          <div class="home__month">
            <div class="home__month-main">
              <span class="home__label">
                今月<span class="home__pc-only">の支出({range})</span>
              </span>
              <span class="home__mid num" aria-label={`今月の合計 ${data.month.total}円`}>
                {formatYen(data.month.total)}
              </span>
              <span class="home__label num home__pc-only">{data.month.count}件を記録</span>
            </div>
            <span class="home__range num">
              {range}
              <br />
              {data.month.count}件を記録
            </span>
          </div>
        </section>

        <section class="card home__breakdown" aria-label="大分類別の内訳">
          <div class="home__section-head">
            <h2 class="home__h2">今月の内訳</h2>
            <span class="home__note">記録した範囲の傾向</span>
          </div>
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
                    <span class="home__row-amount num">{formatYen(g.total)}</span>
                    <span class="home__row-pct num">{formatPercent(g.percent)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section class="home__memo" aria-label="メモ付きの支出">
          <div class="home__memo-head">
            <span class="home__memo-label">メモ付きの支出</span>
            <span class="home__memo-value num">
              <b>{memo.percentText}</b> {memo.ratioText}
            </span>
          </div>
          <div class="home__meter" role="img" aria-label={memo.text}>
            <span class="home__meter-fill" style={{ width: `${memo.percent}%` }} />
          </div>
        </section>

        <section class="home__recent-section" aria-label="最近の記録">
          <div class="home__section-head home__section-head--outer">
            <h2 class="home__h2">最近の記録</h2>
            <Link href="/calendar" class="home__all">
              すべて見る
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <p class="muted home__recent-empty">最近の記録はありません。</p>
          ) : (
            <ul class="home__recent">
              {data.recent.map((t) => {
                const m = recentMerchant(t);
                const sub = recentSub(t);
                const icon = chipIcon(cats, t.category?.trim());
                return (
                  <li key={t.id}>
                    <Link href={`/tx/${encodeURIComponent(t.id)}`} class="home__recent-link" aria-label={`${formatDateJa(t.date)} ${m.title} ${t.amount}円。明細を開く`}>
                      <span class="home__recent-date num">{shortDate(t.date)}</span>
                      <span class="home__recent-main">
                        <span class="home__recent-title">
                          {m.title}
                          {(m.missing || t.status === "needs_review") && <span class="chip chip--warn home__chip">要確認</span>}
                        </span>
                        {sub && (
                          <span class="home__recent-sub">
                            {icon && <CategoryIcon icon={icon} size={16} />}
                            {sub}
                          </span>
                        )}
                      </span>
                      <span class="home__recent-amount num">{formatYen(t.amount)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
