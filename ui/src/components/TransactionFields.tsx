import type { CategoriesData } from "../../../src/api/contract";
import { Link } from "../router";
import { groupCategories } from "../pages/categoriesLogic";
import { TAX_FLAG_OPTIONS } from "../pages/dayLogic";
import { invoiceHint, normalizeInvoiceNumber, MAX_ADDRESS, MAX_CLERK, MAX_PHONE, MAX_RECEIPT_NO } from "../receiptDetails";
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
  // レシートの情報(決済時刻・電話・住所・登録番号・担当者・レシート番号)の欄を出すか(編集では出し、日の画面の追加では出さない)
  showDetails?: boolean;
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
      {props.showDetails && <ReceiptDetailFields idPrefix={id} values={f} onChange={props.onChange} />}
    </>
  );
}

// レシートに印字された情報の入力欄。すべて任意(空欄は「値なし」)。登録番号は、入力中に注意書きを出し、欄を離れたら正規化する
function ReceiptDetailFields(props: { idPrefix: string; values: TxFormValues; onChange: (patch: Partial<TxFormValues>) => void }) {
  const { idPrefix: id, values: f } = props;
  const input = (k: keyof TxFormValues) => (e: Event) => props.onChange({ [k]: (e.currentTarget as HTMLInputElement).value });
  const invoiceError = invoiceHint(f.invoice_number);
  return (
    <fieldset class="day__details">
      <legend class="day__h">レシートの情報</legend>
      <p class="muted day__note">レシートに印字されているものだけ入れます(後から店に問い合わせるときの手がかり)。</p>
      <label for={`${id}-paidtime`}>決済時刻(日本時間)</label>
      <input id={`${id}-paidtime`} type="time" value={f.paid_time} onInput={input("paid_time")} />
      <label for={`${id}-phone`}>店の電話番号</label>
      <input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="off" maxLength={MAX_PHONE} placeholder="例: 03-0000-0000" value={f.merchant_phone} onInput={input("merchant_phone")} />
      <label for={`${id}-address`}>店の住所</label>
      <textarea id={`${id}-address`} rows={2} maxLength={MAX_ADDRESS} value={f.merchant_address} onInput={input("merchant_address")} />
      <label for={`${id}-invoice`}>事業者登録番号(インボイス)</label>
      <input
        id={`${id}-invoice`}
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellcheck={false}
        placeholder="例: T0000000000000"
        aria-invalid={invoiceError ? "true" : undefined}
        aria-describedby={invoiceError ? `${id}-invoice-err` : undefined}
        value={f.invoice_number}
        onInput={input("invoice_number")}
        onBlur={() => {
          if (!invoiceError && f.invoice_number.trim() !== "") props.onChange({ invoice_number: normalizeInvoiceNumber(f.invoice_number) });
        }}
      />
      {invoiceError && f.invoice_number.trim() !== "" && (
        <p id={`${id}-invoice-err`} class="error day__fielderr" role="alert">
          {invoiceError}
        </p>
      )}
      <label for={`${id}-clerk`}>対応した人(担当・責任者・レジ)</label>
      <input id={`${id}-clerk`} type="text" maxLength={MAX_CLERK} value={f.clerk_name} onInput={input("clerk_name")} />
      <label for={`${id}-receiptno`}>レシート番号・伝票番号</label>
      <input id={`${id}-receiptno`} type="text" autoComplete="off" maxLength={MAX_RECEIPT_NO} value={f.receipt_no} onInput={input("receipt_no")} />
    </fieldset>
  );
}
