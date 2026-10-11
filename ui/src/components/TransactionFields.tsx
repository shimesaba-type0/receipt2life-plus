import type { CategoriesData } from "../../../src/api/contract";
import { Link } from "../router";
import { groupCategories } from "../pages/categoriesLogic";
import { TAX_FLAG_OPTIONS } from "../pages/dayLogic";
import type { TxFormValues } from "../pages/transactionLogic";
import "../pages/Day.css";

// カテゴリの select。大分類ごとの optgroup(サーバーの並びのまま)。value が "" のものが先頭の「未設定」(emptyLabel で文言を変えられる)
export function CategorySelect(props: { id: string; value: string; cats: CategoriesData; onChange: (value: string) => void; emptyLabel?: string; disabled?: boolean; "aria-label"?: string }) {
  const { value, cats } = props;
  const groups = groupCategories(cats.categories);
  const known = cats.categories.some((c) => c.name === value);
  return (
    <select id={props.id} value={value} disabled={props.disabled} aria-label={props["aria-label"]} onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value)}>
      <option value="">{props.emptyLabel ?? "未設定"}</option>
      {value && !known && <option value={value}>{value}</option>}
      {groups.map((g) => (
        <optgroup label={g.group_name} key={g.group_name}>
          {g.categories.map((c) => (
            <option value={c.name} key={c.name}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// 税金のフラグの select。value が "" のものが先頭(既定は「なし」)
export function TaxFlagSelect(props: { id: string; value: string; onChange: (value: string) => void; emptyLabel?: string; disabled?: boolean; "aria-label"?: string }) {
  return (
    <select id={props.id} value={props.value} disabled={props.disabled} aria-label={props["aria-label"]} onChange={(e) => props.onChange((e.currentTarget as HTMLSelectElement).value)}>
      {TAX_FLAG_OPTIONS.map((o) => (
        <option value={o.value} key={o.value}>
          {o.value === "" && props.emptyLabel ? props.emptyLabel : o.label}
        </option>
      ))}
    </select>
  );
}

// 取引のフォーム項目(金額・店名・日付・カテゴリ・口座・税金のフラグ・メモ)。<form class="day__form"> の中に置く
export function TransactionFields(props: {
  idPrefix: string;
  values: TxFormValues;
  cats: CategoriesData;
  onChange: (patch: Partial<TxFormValues>) => void;
  // 日付の欄を出すか(編集では出し、日の画面の追加では出さない)
  showDate?: boolean;
}) {
  const { idPrefix: id, values: f, cats } = props;
  const input = (k: keyof TxFormValues) => (e: Event) => props.onChange({ [k]: (e.currentTarget as HTMLInputElement).value });
  const accountKnown = cats.accounts.includes(f.account);
  return (
    <>
      <label for={`${id}-amount`}>金額(円)</label>
      <input id={`${id}-amount`} type="text" inputMode="numeric" required value={f.amount} onInput={input("amount")} />
      <label for={`${id}-merchant`}>店名</label>
      <input id={`${id}-merchant`} type="text" value={f.merchant} onInput={input("merchant")} />
      {props.showDate && (
        <>
          <label for={`${id}-date`}>日付</label>
          <input id={`${id}-date`} type="date" required value={f.date} onInput={input("date")} />
        </>
      )}
      <label for={`${id}-category`}>カテゴリ</label>
      <CategorySelect id={`${id}-category`} value={f.category} cats={cats} onChange={(category) => props.onChange({ category })} />
      <Link href="/categories" class="day__catlink">
        カテゴリを編集
      </Link>
      <label for={`${id}-account`}>口座</label>
      <select id={`${id}-account`} value={f.account} onChange={input("account")}>
        <option value="">未設定</option>
        {f.account && !accountKnown && <option value={f.account}>{f.account}</option>}
        {cats.accounts.map((a) => (
          <option value={a} key={a}>
            {a}
          </option>
        ))}
      </select>
      <label for={`${id}-taxflag`}>税金のフラグ</label>
      <TaxFlagSelect id={`${id}-taxflag`} value={f.tax_flag} onChange={(tax_flag) => props.onChange({ tax_flag })} />
      <label for={`${id}-memo`}>メモ</label>
      <textarea id={`${id}-memo`} rows={2} value={f.memo} onInput={input("memo")} />
    </>
  );
}
