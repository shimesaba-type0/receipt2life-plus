import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiResult, SubscriptionView, SubscriptionsData } from "../../../src/api/contract";
import { addSubscription, deleteSubscription, getSubscriptions, updateSubscription } from "../api";
import { BrandMark } from "../components/BrandMark";
import { formatYen } from "../format";
import { errorText } from "./categoriesLogic";
import {
  KIND_LABELS,
  KIND_OPTIONS,
  MAX_SUBSCRIPTION_NAME,
  MAX_SUBSCRIPTION_NOTE,
  PERIOD_LABELS,
  CURRENCY_OPTIONS,
  amountLabel,
  estimateYen,
  foreignLabel,
  billingDayLabel,
  buildStack,
  emptySubscriptionForm,
  formFromSubscription,
  groupSubscriptions,
  monthLabel,
  nextPaymentLabel,
  priceChangeLabel,
  priceCheckedLabel,
  safeHttpsUrl,
  validateSubscriptionForm,
  type SubscriptionFormInput,
  type SubscriptionFormValue,
} from "./subscriptionsLogic";
import "./Categories.css";
import "./Subscriptions.css";

// いま開いているフォーム(同時に1つだけ)
type Mode = { kind: "none" } | { kind: "edit"; id: string } | { kind: "add" };

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// サブスク・保険などの固定費。支出(transactions)には数えない別枠
export function Subscriptions() {
  const [data, setData] = useState<SubscriptionsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function load() {
    try {
      const res = await getSubscriptions();
      if (res.ok) {
        setData(res);
        setLoadError(null);
      } else {
        setLoadError(errorText(res.errors));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "読み込めませんでした。");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // 変更を1件ずつ実行する(二重送信を防ぐ)。成功したらお知らせを出してフォームを閉じ、読み直す
  async function act<T extends { message: string }>(call: () => Promise<ApiResult<T>>): Promise<string | null> {
    if (busyRef.current) return "処理中です。少し待ってください。";
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const res = await call();
      if (!res.ok) return errorText(res.errors);
      setNotice(res.message);
      setMode({ kind: "none" });
      await load();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "通信に失敗しました。";
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const open = (m: Mode) => {
    setNotice(null);
    setMode(m);
  };
  const close = () => setMode({ kind: "none" });

  const items = data?.subscriptions ?? [];
  const groups = groupSubscriptions(items);
  const stack = buildStack(items);

  const renderRow = (s: SubscriptionView) => {
    const editing = mode.kind === "edit" && mode.id === s.id;
    return (
      <li key={s.id} class={`sub__row${editing ? " is-editing" : ""}`}>
        {editing ? (
          <SubscriptionForm
            initial={formFromSubscription(s)}
            existing={s}
            busy={busy}
            label={`「${s.name}」の編集`}
            submitLabel="保存"
            onSubmit={(v) => act(() => updateSubscription(s.id, toPatch(v)))}
            onCheckPrice={() => act(() => updateSubscription(s.id, { price_checked: true }))}
            onDelete={() => act(() => deleteSubscription(s.id))}
            onCancel={close}
          />
        ) : (
          <Row s={s} onEdit={() => open({ kind: "edit", id: s.id })} />
        )}
      </li>
    );
  };

  return (
    <section class="page cat" aria-labelledby="sub-title">
      <header class="cat__header">
        <h1 id="sub-title" class="cat__title">
          サブスク・固定費
        </h1>
        <p class="cat__lead">動画配信・保険・通信費など、決まった額を払い続けているものの一覧です。</p>
        <p class="muted cat__hint">ここに登録しても支出には数えません。実際に払った分は、レシートとして記録します。</p>
      </header>

      {notice && (
        <p class="cat__notice" role="status">
          {notice}
        </p>
      )}
      {data === null && loadError === null && (
        <p class="muted cat__status" role="status">
          読み込み中です…
        </p>
      )}
      {loadError !== null && (
        <div class="cat__status" role="alert">
          <p class="error">{loadError}</p>
          <button type="button" class="btn" onClick={() => void load()}>
            もう一度読み込む
          </button>
        </div>
      )}

      {data !== null && items.length === 0 && mode.kind !== "add" && (
        <div class="cat__card sub__empty">
          <BrandMark size={36} faint />
          <p>まだ登録がありません。</p>
          <p class="muted">AI(Claude など)に「◯◯のサブスクを月額◯円で登録して」と頼んでも追加できます。</p>
        </div>
      )}

      {data !== null && items.length > 0 && (
        <>
          <section class="cat__card" aria-labelledby="sub-total-heading">
            <h2 id="sub-total-heading" class="cat__group">
              契約中の合計
            </h2>
            <div class="sub__totals">
              <div class="sub__total">
                <span class="sub__total-label">月あたり</span>
                <span class="sub__total-value num">{formatYen(data.totals.monthly)}</span>
              </div>
              <div class="sub__total">
                <span class="sub__total-label">年あたり</span>
                <span class="sub__total-value num">{formatYen(data.totals.yearly)}</span>
              </div>
              <p class="sub__total-count">契約中 {data.totals.count}件(解約済みは含みません)</p>
            </div>
          </section>

          {stack.length > 0 && (
            <section class="cat__card" aria-labelledby="sub-stack-heading">
              <h2 id="sub-stack-heading" class="cat__group">
                月あたりの内訳
              </h2>
              <div class="sub__bar" role="img" aria-label={`月あたりの内訳: ${stack.map((g) => `${g.name} ${formatYen(g.monthly)}(${g.percentText})`).join("、")}`}>
                {stack.map((g) => (
                  <span key={g.id} class="sub__bar-seg" style={{ width: `${g.width}%`, background: g.color }} />
                ))}
              </div>
              <ul class="sub__legend">
                {stack.map((g) => (
                  <li key={g.id} class="sub__legend-item">
                    <span class="sub__swatch" style={{ background: g.color }} aria-hidden="true" />
                    <span class="sub__legend-name">{g.name}</span>
                    <span class="sub__legend-amount num">{formatYen(g.monthly)}/月</span>
                    <span class="sub__legend-pct num">{g.percentText}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {data !== null && (
        <section class="cat__card" aria-labelledby="sub-list-heading">
          <header class="cat__card-head">
            <h2 id="sub-list-heading" class="cat__group">
              登録されている項目
            </h2>
          </header>

          {groups.monthly.length > 0 && (
            <>
              <h3 class="sub__subhead">月払い</h3>
              <ul class="cat__list">{groups.monthly.map(renderRow)}</ul>
            </>
          )}
          {groups.yearly.length > 0 && (
            <>
              <h3 class="sub__subhead">年払い</h3>
              <ul class="cat__list">{groups.yearly.map(renderRow)}</ul>
            </>
          )}

          {mode.kind === "add" ? (
            <SubscriptionForm
              initial={emptySubscriptionForm()}
              existing={null}
              busy={busy}
              label="サブスク・固定費を追加"
              submitLabel="追加"
              onSubmit={(v) => act(() => addSubscription(toNew(v)))}
              onCancel={close}
            />
          ) : (
            <button type="button" class="cat__add" onClick={() => open({ kind: "add" })}>
              <span aria-hidden="true">＋</span> 追加
            </button>
          )}

          {groups.cancelled.length > 0 && (
            <details class="sub__cancelled">
              <summary>解約済み({groups.cancelled.length}件)</summary>
              <ul class="cat__list">{groups.cancelled.map(renderRow)}</ul>
            </details>
          )}
        </section>
      )}
    </section>
  );
}

// 金額まわりの入力。円払いは amount、外貨払いは外貨の金額とレート(円はサーバーが計算する)
function moneyOf(v: SubscriptionFormValue) {
  return v.currency === "JPY" || v.foreign_amount === null || v.exchange_rate === null
    ? { currency: "JPY" as const, amount: v.amount ?? 0 }
    : { currency: v.currency, foreign_amount: v.foreign_amount, exchange_rate: v.exchange_rate };
}

// 更新の入力(フォームの全項目。billing_month などは空なら null で消す)
function toPatch(v: SubscriptionFormValue) {
  return {
    name: v.name,
    ...moneyOf(v),
    period: v.period,
    kind: v.kind,
    active: v.active,
    billing_month: v.billing_month,
    billing_day: v.billing_day,
    url: v.url,
    note: v.note,
  };
}

// 追加の入力。null の項目は送らない
function toNew(v: SubscriptionFormValue) {
  return {
    name: v.name,
    ...moneyOf(v),
    period: v.period,
    kind: v.kind,
    active: v.active,
    ...(v.billing_month !== null ? { billing_month: v.billing_month } : {}),
    ...(v.billing_day !== null ? { billing_day: v.billing_day } : {}),
    ...(v.url !== null ? { url: v.url } : {}),
    ...(v.note !== null ? { note: v.note } : {}),
  };
}

function Row(props: { s: SubscriptionView; onEdit: () => void }) {
  const { s } = props;
  const change = priceChangeLabel(s);
  const foreign = foreignLabel(s);
  const up = s.currency === "JPY" ? s.previous_amount !== null && s.amount > s.previous_amount : (s.foreign_amount ?? 0) > (s.previous_foreign_amount ?? Infinity);
  const next = s.period === "yearly" ? nextPaymentLabel(s.next_billing_month) : null;
  const checked = priceCheckedLabel(s.price_checked_on);
  const day = billingDayLabel(s);
  const href = safeHttpsUrl(s.url);
  return (
    <div class="sub__row-main">
      <div class="sub__row-body">
        <div class="sub__row-title">
          <span class="sub__name">{s.name}</span>
          <span class="sub__kind">{KIND_LABELS[s.kind]}</span>
        </div>
        <span class="sub__amount num">{amountLabel(s)}</span>
        {foreign && <p class="sub__meta">{foreign}</p>}
        {next && <p class="sub__meta">{next}</p>}
        {day && <p class="sub__meta">{day}</p>}
        {change && <p class={`sub__meta ${up ? "sub__up" : "sub__down"}`}>{change}</p>}
        {checked && <p class="sub__meta">{checked}</p>}
        {s.note && <p class="sub__meta">{s.note}</p>}
        {href && (
          <p class="sub__meta">
            <a class="sub__link" href={href} target="_blank" rel="noopener noreferrer">
              {href}
            </a>
          </p>
        )}
      </div>
      <button type="button" class="cat__link" aria-label={`「${s.name}」を編集`} onClick={props.onEdit}>
        編集
      </button>
    </div>
  );
}

function SubscriptionForm(props: {
  initial: SubscriptionFormInput;
  existing: SubscriptionView | null;
  busy: boolean;
  label: string;
  submitLabel: string;
  onSubmit: (v: SubscriptionFormValue) => Promise<string | null>;
  onCheckPrice?: () => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const { busy } = props;
  const [f, setF] = useState<SubscriptionFormInput>(props.initial);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const idBase = useRef(`sub-${Math.random().toString(36).slice(2, 8)}`).current;
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const set = <K extends keyof SubscriptionFormInput>(key: K, value: SubscriptionFormInput[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const text = (key: "name" | "amount" | "foreignAmount" | "exchangeRate" | "billingDay" | "url") => (e: Event) => set(key, (e.currentTarget as HTMLInputElement).value);

  async function submit(e: Event) {
    e.preventDefault();
    const check = validateSubscriptionForm(f);
    if (!check.ok) return setError(check.error);
    setError(null);
    setError(await props.onSubmit(check.value));
  }

  async function run(call: () => Promise<string | null>) {
    setError(null);
    setError(await call());
  }

  return (
    <form class="cat__form cat__edit sub__form" onSubmit={submit} aria-label={props.label} noValidate>
      <label for={`${idBase}-name`}>名前</label>
      <input id={`${idBase}-name`} ref={nameRef} type="text" value={f.name} maxLength={MAX_SUBSCRIPTION_NAME} onInput={text("name")} autocomplete="off" />

      <label for={`${idBase}-kind`}>種類</label>
      <select id={`${idBase}-kind`} value={f.kind} onChange={(e) => set("kind", (e.currentTarget as HTMLSelectElement).value as SubscriptionFormInput["kind"])}>
        {KIND_OPTIONS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>

      <label for={`${idBase}-currency`}>通貨</label>
      <select id={`${idBase}-currency`} value={f.currency} onChange={(e) => set("currency", (e.currentTarget as HTMLSelectElement).value as SubscriptionFormInput["currency"])}>
        {CURRENCY_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      <div class="sub__two">
        <div>
          {f.currency === "JPY" ? (
            <>
              <label for={`${idBase}-amount`}>金額(円)</label>
              <input id={`${idBase}-amount`} type="text" inputMode="numeric" value={f.amount} onInput={text("amount")} autocomplete="off" />
            </>
          ) : (
            <>
              <label for={`${idBase}-foreign`}>金額({f.currency})</label>
              <input id={`${idBase}-foreign`} type="text" inputMode="decimal" value={f.foreignAmount} onInput={text("foreignAmount")} autocomplete="off" placeholder="例: 20" />
            </>
          )}
        </div>
        <div>
          <label for={`${idBase}-period`}>周期</label>
          <select
            id={`${idBase}-period`}
            value={f.period}
            onChange={(e) => {
              const period = (e.currentTarget as HTMLSelectElement).value as SubscriptionFormInput["period"];
              setF((prev) => ({ ...prev, period, billingMonth: period === "yearly" ? prev.billingMonth : "" }));
            }}
          >
            {(["monthly", "yearly"] as const).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {f.currency !== "JPY" && (
        <div class="sub__rate">
          <label for={`${idBase}-rate`}>換算レート(1{f.currency}=何円。目安)</label>
          <input id={`${idBase}-rate`} type="text" inputMode="decimal" value={f.exchangeRate} onInput={text("exchangeRate")} autocomplete="off" placeholder="例: 150" />
          <p class="muted cat__hint">{rateHint(f)}</p>
        </div>
      )}

      <div class="sub__two">
        {f.period === "yearly" && (
          <div>
            <label for={`${idBase}-month`}>更新月(任意)</label>
            <select id={`${idBase}-month`} value={f.billingMonth} onChange={(e) => set("billingMonth", (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">指定しない</option>
              {MONTHS.map((m) => (
                <option key={m} value={String(m)}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label for={`${idBase}-day`}>支払日(任意、1〜31)</label>
          <input id={`${idBase}-day`} type="text" inputMode="numeric" value={f.billingDay} onInput={text("billingDay")} autocomplete="off" />
        </div>
      </div>

      <label for={`${idBase}-url`}>URL(任意。https のみ)</label>
      <input id={`${idBase}-url`} type="url" value={f.url} onInput={text("url")} autocomplete="off" placeholder="https://" />

      <label for={`${idBase}-note`}>メモ(任意)</label>
      <textarea id={`${idBase}-note`} value={f.note} maxLength={MAX_SUBSCRIPTION_NOTE} onInput={(e) => set("note", (e.currentTarget as HTMLTextAreaElement).value)} />

      <label class="sub__check" for={`${idBase}-active`}>
        <input id={`${idBase}-active`} type="checkbox" checked={f.active} onChange={(e) => set("active", (e.currentTarget as HTMLInputElement).checked)} />
        契約中(外すと解約済みになり、合計に入りません)
      </label>

      <p class="error cat__error" role="alert" hidden={error === null}>
        {error}
      </p>
      <div class="cat__actions">
        <button type="submit" class="btn btn--primary" disabled={busy}>
          {busy ? "保存中…" : props.submitLabel}
        </button>
        <button type="button" class="btn" disabled={busy} onClick={props.onCancel}>
          キャンセル
        </button>
      </div>

      {props.existing && props.onCheckPrice && (
        <div class="cat__delete">
          <p class="muted cat__hint">{priceCheckedLabel(props.existing.price_checked_on) ?? "金額はまだ確認していません"}</p>
          <button type="button" class="btn" disabled={busy} onClick={() => void run(props.onCheckPrice as () => Promise<string | null>)}>
            金額を確認した(変わっていない)
          </button>
        </div>
      )}
      {props.existing && props.onDelete && (
        <div class="cat__delete">
          {confirming ? (
            <div class="cat__confirm" role="group" aria-label={`「${props.existing.name}」の削除の確認`}>
              <p>「{props.existing.name}」を削除します。この操作は取り消せません。</p>
              <div class="cat__actions">
                <button type="button" class="btn cat__danger" disabled={busy} onClick={() => void run(props.onDelete as () => Promise<string | null>)}>
                  削除する
                </button>
                <button type="button" class="btn" disabled={busy} onClick={() => setConfirming(false)}>
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <button type="button" class="btn cat__danger" disabled={busy} onClick={() => setConfirming(true)}>
              削除…
            </button>
          )}
        </div>
      )}
    </form>
  );
}

// 換算レートの下の説明。円の目安を出す(実際の引き落とし額は、カードの明細の円)
function rateHint(f: SubscriptionFormInput): string {
  const amount = Number(f.foreignAmount.normalize("NFKC").replace(/[,\s]/g, ""));
  const rate = Number(f.exchangeRate.normalize("NFKC").replace(/[,\s]/g, ""));
  const base = "実際の引き落とし額は、カードの明細の円(レートと手数料はカード会社が決めます)。ここは合計を出すための目安です。";
  if (!(amount > 0) || !(rate > 0)) return base;
  return `円の目安: ${formatYen(estimateYen(amount, rate))}。${base}`;
}
