import { useEffect, useState } from "preact/hooks";
import { BrandMark } from "../components/BrandMark";
import type { CategoriesData, HomeData } from "../../../src/api/contract";
import { getCategories, getHome } from "../api";
import { CategoryIcon } from "../components/CategoryIcon";
import { DiscountIcon } from "../components/DiscountIcon";
import { BreakdownCard } from "../components/BreakdownCard";
import { CompareCard } from "../components/CompareCard";
import { chipIcon } from "../categoryIcons";
import { formatDateJa, formatYen, todayJst } from "../format";
import { Link } from "../router";
import { discountsView, isEmptyHome, monthRangeLabel, recentMerchant, recentSub, reviewHref, reviewLabel, shortDate } from "./homeLogic";
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
          <img class="home__brand" src="/brand/wordmark.svg" alt="Receipt to Life +" />
          <h1 class="home__date">{formatDateJa(today)}</h1>
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
          <BrandMark size={20} faint />{" "}
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
  const discounts = discountsView(data.discounts);
  const range = monthRangeLabel(data.month.from, data.today.date);

  return (
    <>
      {isEmptyHome(data) && (
        <div class="card home__empty" role="status">
          <BrandMark size={48} faint class="brandmark-empty" />
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

        {/* 今日は、レシートをその日に取り込むとは限らず、0円の日が普通にあるので、小さな1行にする。今月の合計は内訳のドーナツの中央にあるので、枠は出さない */}
        <p class="home__today" aria-label={`今日の合計 ${data.today.total}円、${data.today.count}件の記録`}>
          <span class="home__label">今日</span>
          <span class="home__today-amount num">{formatYen(data.today.total)}</span>
          <span class="home__label num">{data.today.count}件の記録</span>
        </p>

        <section class="card home__discounts" aria-label="今月の割引">
          <span class="home__label home__discounts-label"><DiscountIcon size={22} />今月の割引</span>
          {discounts.empty ? (
            <span class="home__discounts-empty">{discounts.countText}</span>
          ) : (
            <>
              <span class="home__discounts-amount num" aria-label={discounts.ariaLabel}>
                {discounts.amountText}
              </span>
              <span class="home__label num">{discounts.countText}</span>
            </>
          )}
          <span class="home__discounts-note">{discounts.note}</span>
        </section>

        <BreakdownCard title="今月の内訳" note={`${range}・${data.month.count}件を記録`} groups={data.groups} total={data.month.total} emptyText="今月の支出はまだありません。" />

        <CompareCard month={data.month.month} />

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
