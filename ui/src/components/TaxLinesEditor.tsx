import { BASIS_OPTIONS, MAX_TAX_LABEL, MAX_TAX_LINES, emptyTaxLineRow, type TaxLineRow } from "../pages/taxLogic";
import { TaxRateFields } from "./TransactionFields";

// 税の内訳(レシート下部の「10%対象 ¥1,100 消費税 ¥100」など)の編集。行の追加・削除ができる。<form class="day__form"> の中に置く
// 数字は印字どおりに入れる(こちらで計算しない)。税込か税抜かは、分かるときだけ選ぶ
export function TaxLinesEditor(props: { idPrefix: string; rows: TaxLineRow[]; onChange: (rows: TaxLineRow[]) => void; nextKey: () => string; busy?: boolean }) {
  const { idPrefix: id, rows, busy } = props;
  const setRow = (key: string, patch: Partial<TaxLineRow>) => props.onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <fieldset class="tx__editor">
      <legend class="day__h">税の内訳</legend>
      <p class="muted tx__hint">レシートの下にある税率ごとの合計(「10%対象 ¥1,100 消費税 ¥100」など)を、印字どおりに入れます。印字が無い項目は空欄のままにします。</p>
      {rows.length > 0 && (
        <ul class="tx__rows">
          {rows.map((r, i) => (
            <li key={r.key} class="tx__row">
              <div class="tx__row-head">
                <span class="tx__row-no">{i + 1}行目</span>
                <button type="button" class="tx__remove" aria-label={`税の内訳の${i + 1}行目を削除`} disabled={busy} onClick={() => props.onChange(rows.filter((x) => x.key !== r.key))}>
                  ×
                </button>
              </div>
              <TaxRateFields id={`${id}-${r.key}`} label="税率" choice={r.rate_choice} other={r.rate_other} disabled={busy} onChange={(patch) => setRow(r.key, patch)} />
              <label for={`${id}-${r.key}-taxable`}>対象金額(円)</label>
              <input id={`${id}-${r.key}-taxable`} type="text" inputMode="numeric" autoComplete="off" placeholder="例: 1100" value={r.taxable_amount} disabled={busy} onInput={(e) => setRow(r.key, { taxable_amount: (e.currentTarget as HTMLInputElement).value })} />
              <label for={`${id}-${r.key}-tax`}>消費税額(円)</label>
              <input id={`${id}-${r.key}-tax`} type="text" inputMode="numeric" autoComplete="off" placeholder="例: 100" value={r.tax_amount} disabled={busy} onInput={(e) => setRow(r.key, { tax_amount: (e.currentTarget as HTMLInputElement).value })} />
              <label for={`${id}-${r.key}-basis`}>対象金額は税込か税抜か(任意)</label>
              <select id={`${id}-${r.key}-basis`} value={r.amount_basis} disabled={busy} onChange={(e) => setRow(r.key, { amount_basis: (e.currentTarget as HTMLSelectElement).value as TaxLineRow["amount_basis"] })}>
                {BASIS_OPTIONS.map((o) => (
                  <option value={o.value} key={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <label for={`${id}-${r.key}-label`}>印字の記号(任意)</label>
              <input id={`${id}-${r.key}-label`} type="text" maxLength={MAX_TAX_LABEL} placeholder="例: ※ / 軽" value={r.label} disabled={busy} onInput={(e) => setRow(r.key, { label: (e.currentTarget as HTMLInputElement).value })} />
            </li>
          ))}
        </ul>
      )}
      <button type="button" class="btn" disabled={busy || rows.length >= MAX_TAX_LINES} onClick={() => props.onChange([...rows, emptyTaxLineRow(props.nextKey())])}>
        税率の行を追加
      </button>
      {rows.length >= MAX_TAX_LINES && <p class="muted tx__hint">税の内訳は{MAX_TAX_LINES}行までです。</p>}
    </fieldset>
  );
}
