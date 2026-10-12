import type { SummaryRow } from "../../../src/api/contract";
import { formatYen } from "../format";
import { formatPercent, groupColor } from "../pages/homeLogic";
import { DonutChart } from "./DonutChart";

// 大分類別の内訳(ドーナツと一覧)。ホームの「今月の内訳」と、カレンダーの月の内訳で同じものを使う。
// 見た目の CSS は Home.css(home__*)。1つのバンドルに入っているので、どのページからでも効く
export function BreakdownCard(props: { title: string; note?: string; groups: SummaryRow[]; total: number; emptyText: string; ariaLabel?: string; caption?: string }) {
  const { title, note, groups, total, emptyText } = props;
  const hasBreakdown = groups.some((g) => g.total > 0);
  return (
    <section class="card home__breakdown" aria-label={props.ariaLabel ?? "大分類別の内訳"}>
      <div class="home__section-head">
        <h2 class="home__h2">{title}</h2>
        {note && <span class="home__note">{note}</span>}
      </div>
      {!hasBreakdown ? (
        <p class="muted">{emptyText}</p>
      ) : (
        <div class="home__donut-wrap">
          <DonutChart groups={groups} total={total} caption={props.caption} />
          <ul class="home__list">
            {groups.map((g, i) => (
              <li key={g.key} class="home__row">
                <span class="home__swatch" style={{ background: groupColor(i) }} aria-hidden="true" />
                <span class="home__row-name">{g.label}</span>
                <span class="home__row-amount num">{formatYen(g.total)}</span>
                <span class="home__row-pct num">{formatPercent(g.percent)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
