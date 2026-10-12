import type { SummaryRow } from "../../../src/api/contract";
import { formatPercent } from "../pages/homeLogic";
import { DONUT, donutSlices } from "../pages/homeLogic";
import { formatYen } from "../format";

// 大分類別の内訳のドーナツグラフ。上位の区分には % を、リングの中に入れる。中央に今月の合計
export function DonutChart(props: { groups: SummaryRow[]; total: number }) {
  const { groups, total } = props;
  const slices = donutSlices(groups);
  const { size, r, stroke } = DONUT;
  const c = size / 2;
  const label = `大分類別の内訳: ${slices.map((s) => `${s.label} ${formatPercent(s.percent)}`).join("、")}`;
  return (
    <svg class="home__donut" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <g transform={`rotate(-90 ${c} ${c})`}>
        {slices.map((s) => (
          <circle key={s.key} cx={c} cy={c} r={r} fill="none" stroke={s.color} stroke-width={stroke} stroke-dasharray={`${s.dash} ${s.gap}`} stroke-dashoffset={s.offset} />
        ))}
      </g>
      {slices.map((s) =>
        s.inner ? (
          <text key={s.key} x={s.inner.x} y={s.inner.y} text-anchor="middle" dominant-baseline="central" class="home__donut-pct" fill={s.inner.color}>
            {s.inner.text}
          </text>
        ) : null,
      )}
      <text x={c} y={c - 9} text-anchor="middle" class="home__donut-cap">
        今月
      </text>
      <text x={c} y={c + 11} text-anchor="middle" class="home__donut-total">
        {formatYen(total)}
      </text>
    </svg>
  );
}
