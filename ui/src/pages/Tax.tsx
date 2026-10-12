import { useEffect, useRef, useState } from "preact/hooks";
import type { TaxSummaryData, TaxSummaryRow } from "../../../src/api/contract";
import { UnauthorizedError, getTaxSummary } from "../api";
import { formatMonthJa, formatYen, todayJst } from "../format";
import { errorsMessage } from "./transactionLogic";
import { PERIOD_OPTIONS, coverageNote, formatRate, groupRowsByMonth, isEmptySummary, periodRange, taxSummaryQuery, type PeriodKind } from "./taxLogic";
import "./Tax.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "invalid"; message: string } | { kind: "ready"; data: TaxSummaryData };

// 税額(/tax): レシートに印字された税額を、期間ごとに税率別(または月別)に合計する。印字どおりの数字だけで、計算はしない
export function Tax() {
  const today = todayJst();
  const [period, setPeriod] = useState<PeriodKind>("this_month");
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [byMonth, setByMonth] = useState(false);
  const [state, setState] = useState<State>({ kind: "loading" });
  // 古い読み込みの結果で、新しい結果を上書きしない
  const seq = useRef(0);

  const range = periodRange(period, today, custom);

  async function load() {
    if (!range.ok) {
      setState({ kind: "invalid", message: range.error });
      return;
    }
    const mine = (seq.current += 1);
    setState({ kind: "loading" });
    try {
      const res = await getTaxSummary(taxSummaryQuery(range.from, range.to, byMonth ? "month" : "rate"));
      if (mine !== seq.current) return;
      setState(res.ok ? { kind: "ready", data: res } : { kind: "error", message: errorsMessage(res.errors) });
    } catch (e) {
      if (mine !== seq.current) return;
      setState({ kind: "error", message: e instanceof UnauthorizedError ? e.message : "通信に失敗しました。" });
    }
  }

  useEffect(() => {
    void load();
  }, [period, custom.from, custom.to, byMonth]);

  return (
    <section class="page taxp">
      <header class="taxp__head">
        <h1 class="page__title">税額</h1>
        <p class="muted taxp__lead">レシートに印字された消費税額を、税率ごとに合計します。税の内訳を記録した支出だけが対象です(計算で補いません)。</p>
      </header>

      <div class="card taxp__controls">
        <div class="taxp__periods" role="group" aria-label="期間">
          {PERIOD_OPTIONS.map((o) => (
            <button type="button" key={o.value} class={`taxp__period${period === o.value ? " is-active" : ""}`} aria-pressed={period === o.value} onClick={() => setPeriod(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div class="taxp__custom">
            <label>
              <span>開始日</span>
              <input type="date" value={custom.from} max={custom.to || undefined} onInput={(e) => setCustom((c) => ({ ...c, from: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
            <label>
              <span>終了日</span>
              <input type="date" value={custom.to} min={custom.from || undefined} onInput={(e) => setCustom((c) => ({ ...c, to: (e.currentTarget as HTMLInputElement).value }))} />
            </label>
          </div>
        )}
        {range.ok && (
          <p class="muted taxp__range num">
            {range.from} 〜 {range.to}
          </p>
        )}
        <label class="taxp__switch">
          <input type="checkbox" role="switch" checked={byMonth} onChange={(e) => setByMonth((e.currentTarget as HTMLInputElement).checked)} />
          <span>月別に表示する</span>
        </label>
      </div>

      {state.kind === "loading" && (
        <p class="muted" role="status">
          読み込み中…
        </p>
      )}
      {state.kind === "invalid" && (
        <p class="error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "error" && (
        <div class="card">
          <p class="error" role="alert">
            {state.message}
          </p>
          <button type="button" class="btn" onClick={() => void load()}>
            もう一度読み込む
          </button>
        </div>
      )}
      {state.kind === "ready" && <Summary data={state.data} byMonth={byMonth} />}
    </section>
  );
}

function Summary(props: { data: TaxSummaryData; byMonth: boolean }) {
  const { data } = props;
  const note = coverageNote(data.coverage);
  return (
    <>
      {isEmptySummary(data) ? (
        <div class="card taxp__empty" role="status">
          <p class="taxp__empty-title">この期間に、税額の記録はありません</p>
          <p class="muted">支出の明細ページの「編集」から、レシートの税の内訳(税率ごとの対象金額と消費税額)を入れると、ここに集計されます。</p>
        </div>
      ) : props.byMonth ? (
        groupRowsByMonth(data.rows).map((g) => (
          <section class="card" key={g.month} aria-label={formatMonthJa(g.month)}>
            <h2 class="day__h taxp__month">
              {formatMonthJa(g.month)}
              <span class="num taxp__month-total">税額 {formatYen(g.tax_total)}</span>
            </h2>
            <TaxTable rows={g.rows} />
          </section>
        ))
      ) : (
        <section class="card" aria-label="税率別">
          <TaxTable rows={data.rows} total={data.totals} />
        </section>
      )}

      {!isEmptySummary(data) && props.byMonth && (
        <p class="taxp__grand">
          期間の税額の合計 <strong class="num">{formatYen(data.totals.tax_total)}</strong>({data.totals.receipt_count}件)
        </p>
      )}

      <div class="card taxp__notes" role="note">
        <p class={data.coverage.without_tax_lines.count > 0 ? "taxp__coverage is-warn" : "taxp__coverage"}>{note}</p>
        {data.coverage.lines_missing_tax_amount > 0 && <p class="muted">税額の印字が無い(記録していない)行が{data.coverage.lines_missing_tax_amount}行あります。その行の税額は合計に含まれていません。</p>}
        {data.totals.mixed_basis && <p class="muted">対象金額には、税込と税抜(または不明)が混ざっています。対象金額の合計は目安として見てください。</p>}
      </div>
    </>
  );
}

function TaxTable(props: { rows: TaxSummaryRow[]; total?: TaxSummaryData["totals"] }) {
  return (
    <div class="taxp__tablewrap">
      <table class="taxp__table">
        <thead>
          <tr>
            <th scope="col">税率</th>
            <th scope="col">税額の合計</th>
            <th scope="col">対象金額の合計</th>
            <th scope="col">件数</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={`${r.month ?? ""}-${r.rate}`}>
              <th scope="row">{formatRate(r.rate)}</th>
              <td class="num">{formatYen(r.tax_total)}</td>
              <td class="num">
                {formatYen(r.taxable_total)}
                {r.mixed_basis && <span class="muted taxp__mixed">(税込・税抜が混在)</span>}
              </td>
              <td class="num">{r.receipt_count}件</td>
            </tr>
          ))}
        </tbody>
        {props.total && (
          <tfoot>
            <tr>
              <th scope="row">合計</th>
              <td class="num">{formatYen(props.total.tax_total)}</td>
              <td class="num">{formatYen(props.total.taxable_total)}</td>
              <td class="num">{props.total.receipt_count}件</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
