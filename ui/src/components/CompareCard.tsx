import { useEffect, useRef, useState } from "preact/hooks";
import type { CompareData } from "../../../src/api/contract";
import { getCompare } from "../api";
import { formatYen, todayJst } from "../format";
import { errorText } from "../pages/categoriesLogic";
import { BASE_OPTIONS, DIRECTION_MARK, baseParam, compareApiPath, defaultUntilDay, deltaDirection, monthTitle, percentLabel, signedYen, type BaseChoice } from "../pages/compareLogic";
import "./CompareCard.css";

// 月の比較。先月・前年の同じ月・好きな月と、大分類ごとに比べる。
// 今月(途中の月)は「同じ日まで」にそろえて比べるのが既定(月末までの先月と比べると、必ず減って見えるため)
export function CompareCard(props: { month: string }) {
  const { month } = props;
  const today = todayJst();
  const partialDay = defaultUntilDay(month, today);
  const [choice, setChoice] = useState<BaseChoice>("previous");
  const [custom, setCustom] = useState("");
  const [sameDay, setSameDay] = useState(true);
  const [data, setData] = useState<CompareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const base = baseParam(choice, custom);
  const untilDay = partialDay !== null && sameDay ? partialDay : null;

  useEffect(() => {
    if (base === null) return;
    const mine = ++seq.current;
    setLoading(true);
    getCompare(compareApiPath(month, base, untilDay))
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
        if (mine === seq.current) setError(e instanceof Error ? e.message : "比べられませんでした。");
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [month, base, untilDay]);

  const dir = data ? deltaDirection(data.diff) : "flat";

  return (
    <section class="card cmp" aria-label="月の比較">
      <div class="home__section-head">
        <h2 class="home__h2">{monthTitle(month)}を比べる</h2>
        {data && <span class="home__note">{data.until_day ? `どちらも${data.until_day}日まで` : "月全体"}</span>}
      </div>

      <div class="cmp__choices" role="group" aria-label="比べる相手">
        {BASE_OPTIONS.map((o) => (
          <button key={o.value} type="button" class={`cmp__chip${choice === o.value ? " is-on" : ""}`} aria-pressed={choice === o.value} onClick={() => setChoice(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {choice === "custom" && (
        <label class="cmp__custom">
          <span class="muted">比べる月</span>
          <input type="month" value={custom} max={month} onInput={(e) => setCustom((e.currentTarget as HTMLInputElement).value)} />
        </label>
      )}
      {partialDay !== null && (
        <label class="cmp__same">
          <input type="checkbox" checked={sameDay} onChange={(e) => setSameDay((e.currentTarget as HTMLInputElement).checked)} />
          <span>同じ日({partialDay}日)までで比べる</span>
        </label>
      )}

      {base === null && <p class="muted">比べる月を選んでください。</p>}
      {loading && <p class="muted" role="status">比べています…</p>}
      {error !== null && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      {data && base !== null && (
        <div class="cmp__result" aria-live="polite">
          <p class={`cmp__summary is-${dir}`}>
            <span class="cmp__mark" aria-hidden="true">{DIRECTION_MARK[dir]}</span>
            <strong class="num">{signedYen(data.diff)}</strong>
            <span class="num">({percentLabel(data.diff_percent)})</span>
            <span class="muted">{monthTitle(data.base_month)}より{dir === "up" ? "増えました" : dir === "down" ? "減りました" : "同じです"}</span>
          </p>
          <p class="cmp__totals muted num">
            {monthTitle(data.month)} {formatYen(data.total)} ／ {monthTitle(data.base_month)} {formatYen(data.base_total)}
          </p>
          {data.rows.length > 0 && (
            <table class="cmp__table">
              <thead>
                <tr>
                  <th scope="col">大分類</th>
                  <th scope="col" class="num">{Number(data.month.slice(5))}月</th>
                  <th scope="col" class="num">{Number(data.base_month.slice(5))}月</th>
                  <th scope="col" class="num">差</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const d = deltaDirection(r.diff);
                  return (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      <td class="num">{formatYen(r.total)}</td>
                      <td class="num muted">{formatYen(r.base_total)}</td>
                      <td class={`num cmp__diff is-${d}`}>
                        <span aria-hidden="true">{DIRECTION_MARK[d]}</span> {signedYen(r.diff)}
                        <span class="cmp__pct">{percentLabel(r.diff_percent)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
