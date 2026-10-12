import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiResult, CategoriesData, FieldError, PhotoView, TransactionDetailData, TransactionView } from "../../../src/api/contract";
import { UnauthorizedError, deleteLink, deleteTransaction, getCategories, getTransaction, photoUrl, updateLink, updateTransaction } from "../api";
import { CopyValue } from "../components/CopyValue";
import { CategoryChip } from "../components/CategoryIcon";
import { DiscountIcon } from "../components/DiscountIcon";
import { chipIcon } from "../categoryIcons";
import { LinkCard } from "../components/LinkCard";
import { PhotoLightbox } from "../components/PhotoLightbox";
import { CategorySelect, TaxFlagSelect, TaxRateFields, TransactionFields } from "../components/TransactionFields";
import { TaxLinesEditor } from "../components/TaxLinesEditor";
import { formatDateJa, formatYen } from "../format";
import { holidayName } from "../holidays";
import { clockLabel, hasShopInfo, telHref } from "../receiptDetails";
import { Link, navigate } from "../router";
import { categoryChipLabel, taxFlagChipLabel } from "./dayLogic";
import {
  applyBulkCategory,
  applyBulkTaxFlag,
  buildPatch,
  canConfirmDelete,
  canMatchTotal,
  checkTotals,
  deleteSummary,
  effectiveCategory,
  effectiveTaxFlag,
  emptyItemRow,
  errorsMessage,
  formatSignedYen,
  isNotFoundErrors,
  itemRowsFromView,
  matchTotal,
  shouldDeletePhotos,
  txFormFromView,
  viewTotalsLabel,
  MAX_ITEMS,
  type ItemRow,
  type TxFormValues,
} from "./transactionLogic";
import { basisLabel, formatRate, itemRateLabel, taxLineRowsFromView, type TaxLineRow } from "./taxLogic";
import "./Transaction.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notfound" }
  | { kind: "ready"; data: TransactionDetailData };

// API 呼び出しの結果を、成功なら値、失敗なら日本語のメッセージ(と元のエラー)にそろえる
async function run<T>(call: () => Promise<ApiResult<T>>): Promise<{ ok: true; value: T } | { ok: false; message: string; errors: FieldError[] }> {
  try {
    const res = await call();
    if (res.ok) return { ok: true, value: res };
    return { ok: false, message: errorsMessage(res.errors), errors: res.errors };
  } catch (e) {
    const message = e instanceof UnauthorizedError ? e.message : e instanceof Error ? e.message : "通信に失敗しました。";
    return { ok: false, message, errors: [] };
  }
}

export function Transaction(props: { id: string }) {
  const { id } = props;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [cats, setCats] = useState<CategoriesData>({ categories: [], accounts: [] });
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [notice, setNotice] = useState<string | null>(null);
  const [viewPhoto, setViewPhoto] = useState<PhotoView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function load() {
    const res = await run(() => getTransaction(id));
    if (res.ok) setState({ kind: "ready", data: res.value });
    else if (isNotFoundErrors(res.errors)) setState({ kind: "notfound" });
    else setState({ kind: "error", message: res.message });
  }

  useEffect(() => {
    setState({ kind: "loading" });
    setMode("view");
    setNotice(null);
    setActionError(null);
    void load();
  }, [id]);

  useEffect(() => {
    void run(() => getCategories()).then((res) => {
      if (res.ok) setCats(res.value);
    });
  }, []);

  // リンクの操作(タイトル変更・削除)。二重送信を防ぎ、成功したら読み込み直す
  async function linkAction(call: () => Promise<{ ok: true; value: unknown } | { ok: false; message: string }>, done: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const res = await call();
      if (!res.ok) {
        setActionError(res.message);
        return false;
      }
      setNotice(done);
      await load();
      return true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const tx = state.kind === "ready" ? state.data.transaction : null;
  const backHref = tx ? `/day/${tx.date}` : "/";

  return (
    <section class="page tx">
      <header class="tx__head">
        <Link href={backHref} class="tx__back" aria-label={tx ? "この日に戻る" : "ホームに戻る"}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </Link>
        <h1 class="page__title tx__title">明細</h1>
        {state.kind === "ready" && mode === "view" && (
          <button type="button" class="btn" onClick={() => { setNotice(null); setMode("edit"); }}>
            編集
          </button>
        )}
      </header>

      {state.kind === "loading" && <p class="muted">読み込み中…</p>}
      {state.kind === "error" && (
        <div class="card">
          <p class="error" role="alert">
            {state.message}
          </p>
          <button type="button" class="btn" onClick={() => { setState({ kind: "loading" }); void load(); }}>
            もう一度読み込む
          </button>
        </div>
      )}
      {state.kind === "notfound" && (
        <div class="card tx__notfound">
          <p role="alert">この支出は見つかりません</p>
          <p class="muted">削除されたか、リンクが正しくない可能性があります。</p>
          <Link href="/" class="btn tx__linkbtn">
            ホームに戻る
          </Link>
        </div>
      )}

      {notice && (
        <p class="day__notice" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p class="error" role="alert">
          {actionError}
        </p>
      )}

      {state.kind === "ready" && mode === "view" && (
        <>
          <TransactionBody data={state.data} cats={cats} onViewPhoto={setViewPhoto} busy={busy} onSaveLinkTitle={(lid, title) => linkAction(async () => run(() => updateLink(lid, { title })), "リンクのタイトルを保存しました。")} onDeleteLink={(lid) => linkAction(async () => run(() => deleteLink(lid)), "リンクを削除しました。")} />
          <DeleteSection data={state.data} />
        </>
      )}
      {state.kind === "ready" && mode === "edit" && (
        <>
          <EditForm
            tx={state.data.transaction}
            cats={cats}
            onCancel={() => setMode("view")}
            onSaved={async (warnings) => {
              setMode("view");
              // 税の内訳の合計が金額と合わないときは、保存したうえで注意を添える(レシートがマスターなのでエラーにはしない)
              setNotice(["保存しました。", ...warnings].join(" "));
              window.scrollTo(0, 0);
              await load();
            }}
          />
          <DeleteSection data={state.data} />
        </>
      )}

      {viewPhoto && <PhotoLightbox photo={viewPhoto} onClose={() => setViewPhoto(null)} />}
    </section>
  );
}

// ---- 見るだけのビュー ----

function TransactionBody(props: {
  data: TransactionDetailData;
  cats: CategoriesData;
  busy: boolean;
  onViewPhoto: (p: PhotoView) => void;
  onSaveLinkTitle: (id: string, title: string | null) => Promise<boolean>;
  onDeleteLink: (id: string) => Promise<boolean>;
}) {
  const { transaction: tx, photos, links } = props.data;
  const holiday = holidayName(tx.date);
  const catChip = categoryChipLabel(tx.category, props.cats);
  const taxChip = taxFlagChipLabel(tx.tax_flag);
  const totals = tx.items.length > 0 ? viewTotalsLabel(tx) : null;
  const paidClock = clockLabel(tx.paid_time);
  const tel = telHref(tx.merchant_phone);
  return (
    <>
      <div class="card tx__summary">
        <strong class="num tx__amount">{formatYen(tx.amount)}</strong>
        <div class="tx__merchant">
          {tx.merchant ?? "店名なし"}
          {tx.status === "needs_review" && <span class="chip chip--warn tx__review">要確認</span>}
        </div>
        <div class="tx__meta">
          <span>{formatDateJa(tx.date)}</span>
          {paidClock && <span class="num tx__time tx__time-value">{paidClock}</span>}
          {holiday && <span class="chip chip--holiday">{holiday}</span>}
          {tx.account && <span class="muted">{tx.account}</span>}
        </div>
        <dl class="tx__facts">
          <div>
            <dt>カテゴリ</dt>
            <dd>{catChip ? <CategoryChip label={catChip} icon={chipIcon(props.cats, tx.category)} /> : <span class="muted">未設定</span>}</dd>
          </div>
          <div>
            <dt>税金のフラグ</dt>
            <dd>{taxChip ? <span class="chip day__taxflag">{taxChip}</span> : <span class="muted">なし</span>}</dd>
          </div>
          <div>
            <dt>メモ</dt>
            <dd class="tx__memo">{tx.memo ? tx.memo : <span class="muted">なし</span>}</dd>
          </div>
        </dl>
      </div>

      {hasShopInfo(tx) && (
        <section class="card" aria-label="店舗の情報">
          <div class="day__row-head">
            <h2 class="day__h">店舗の情報</h2>
          </div>
          <dl class="tx__facts tx__shop">
            {tx.merchant_phone && (
              <div>
                <dt>電話</dt>
                <dd>{tel ? <a class="tx__tel" href={tel} aria-label={`${tx.merchant_phone} に電話をかける`}>{tx.merchant_phone}</a> : tx.merchant_phone}</dd>
              </div>
            )}
            {tx.merchant_address && (
              <div>
                <dt>住所</dt>
                <dd>
                  <CopyValue text={tx.merchant_address} label="住所" />
                </dd>
              </div>
            )}
            {tx.invoice_number && (
              <div>
                <dt>事業者登録番号</dt>
                <dd>
                  <CopyValue text={tx.invoice_number} label="事業者登録番号" class="num" />
                </dd>
              </div>
            )}
            {tx.clerk_name && (
              <div>
                <dt>対応した人</dt>
                <dd class="tx__memo">{tx.clerk_name}</dd>
              </div>
            )}
            {tx.receipt_no && (
              <div>
                <dt>レシート番号・伝票番号</dt>
                <dd class="tx__memo">{tx.receipt_no}</dd>
              </div>
            )}
            {tx.register_no && (
              <div>
                <dt>レジ番号</dt>
                <dd class="tx__memo">{tx.register_no}</dd>
              </div>
            )}
            {tx.store_code && (
              <div>
                <dt>店番号</dt>
                <dd class="tx__memo">{tx.store_code}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <section class="card" aria-label="明細の行">
        <div class="day__row-head">
          <h2 class="day__h">明細の行</h2>
          {tx.items.length > 0 && <span class="muted tx__count">{tx.items.length}行</span>}
        </div>
        {tx.items.length === 0 ? (
          <p class="muted">明細はありません(1行の支出です)</p>
        ) : (
          <>
            <ul class="tx__items">
              {[...tx.items]
                .sort((a, b) => a.position - b.position)
                .map((it) => {
                  const cat = effectiveCategory(it, tx);
                  const catLabel = categoryChipLabel(cat, props.cats);
                  const flag = taxFlagChipLabel(effectiveTaxFlag(it, tx));
                  const rate = itemRateLabel(it);
                  return (
                    <li key={it.id} class="tx__item">
                      <div class="tx__item-main">
                        <span class="tx__item-name">{it.amount < 0 && <DiscountIcon size={16} />}{it.name}</span>
                        <span class="day__tags">
                          {catLabel ? <CategoryChip label={catLabel} icon={chipIcon(props.cats, cat)} /> : <span class="chip chip--warn">カテゴリ未設定</span>}
                          {flag && <span class="chip day__taxflag">{flag}</span>}
                        </span>
                        {rate && <span class="muted tx__rate" aria-label={`税率 ${rate}`}>{rate}</span>}
                        {it.memo && <span class="muted day__memo">{it.memo}</span>}
                      </div>
                      <span class={`num tx__item-amount${it.amount < 0 ? " is-minus" : ""}`}>{formatSignedYen(it.amount)}</span>
                    </li>
                  );
                })}
            </ul>
            {totals && (
              <div class="tx__subtotal">
                <span class="num tx__subtotal-amount">{totals.total}</span>
                <span class={totals.matches ? "tx__match" : "tx__mismatch"}>{totals.matches ? `✓ ${totals.note}` : totals.note}</span>
              </div>
            )}
          </>
        )}
      </section>

      <section class="card" aria-label="税の内訳">
        <div class="day__row-head">
          <h2 class="day__h">税の内訳</h2>
        </div>
        {tx.tax_lines.length === 0 ? (
          <p class="muted">税の内訳は記録されていません(「編集」で、レシートに印字された税率ごとの金額を入れられます)。</p>
        ) : (
          <div class="tx__taxwrap">
            <table class="tx__tax">
              <thead>
                <tr>
                  <th scope="col">税率</th>
                  <th scope="col">対象金額</th>
                  <th scope="col">消費税</th>
                </tr>
              </thead>
              <tbody>
                {tx.tax_lines.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      {formatRate(l.rate)}
                      {l.label && <span class="muted tx__tax-label"> {l.label}</span>}
                    </th>
                    <td class="num">
                      {l.taxable_amount === null ? <span class="muted">—</span> : formatYen(l.taxable_amount)}
                      {l.amount_basis && <span class="muted tx__tax-basis">({basisLabel(l.amount_basis)})</span>}
                    </td>
                    <td class="num">{l.tax_amount === null ? <span class="muted">—</span> : formatYen(l.tax_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section class="card" aria-label="紐づけた写真">
        <div class="day__row-head">
          <h2 class="day__h">写真</h2>
          <Link href={`/photos/add?date=${encodeURIComponent(tx.date)}&transaction_id=${encodeURIComponent(tx.id)}`} class="btn tx__linkbtn">
            写真を追加
          </Link>
        </div>
        {photos.length === 0 ? (
          <p class="muted">紐づけた写真はありません。</p>
        ) : (
          <ul class="day__photos">
            {photos.map((p) => (
              <li key={p.id} class="day__photo">
                <button type="button" class="day__thumb" onClick={() => props.onViewPhoto(p)} aria-label={p.caption ? `写真を拡大: ${p.caption}` : "写真を拡大"}>
                  <img src={photoUrl(p.id)} alt={p.caption ?? ""} loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {links.length > 0 && (
        <section class="card" aria-label="紐づけたリンク">
          <div class="day__row-head">
            <h2 class="day__h">リンク</h2>
          </div>
          <ul class="day__list day__links">
            {links.map((l) => (
              <li key={l.id}>
                <LinkCard link={l} busy={props.busy} onSaveTitle={props.onSaveLinkTitle} onDelete={props.onDeleteLink} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---- 編集モード ----

function EditForm(props: { tx: TransactionView; cats: CategoriesData; onCancel: () => void; onSaved: (warnings: string[]) => Promise<void> }) {
  const { tx, cats } = props;
  const keyRef = useRef(0);
  const nextKey = () => `new-${(keyRef.current += 1)}`;
  const [form, setForm] = useState<TxFormValues>(() => txFormFromView(tx));
  const [rows, setRows] = useState<ItemRow[]>(() => itemRowsFromView(tx.items));
  const [taxRows, setTaxRows] = useState<TaxLineRow[]>(() => taxLineRowsFromView(tx.tax_lines));
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkTax, setBulkTax] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const id = useRef(`txe-${Math.random().toString(36).slice(2, 8)}`).current;

  const check = checkTotals(rows, form.amount);
  const hadItems = tx.items.length > 0;

  const setRow = (key: string, patch: Partial<ItemRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit() {
    if (busyRef.current) return;
    const built = buildPatch(form, rows, hadItems, { rows: taxRows, had: tx.tax_lines.length > 0 });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await run(() => updateTransaction(tx.id, built.value));
      if (!res.ok) {
        setError(res.message);
        return;
      }
      await props.onSaved((res.value.tax_warnings ?? []).map((w) => w.message));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      class="card day__form tx__form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 class="day__form-title">支出を編集</h2>
      <TransactionFields idPrefix={id} values={form} cats={cats} showDate showDetails onChange={(patch) => setForm((cur) => ({ ...cur, ...patch }))} />

      <fieldset class="tx__editor">
        <legend class="day__h">明細の行</legend>
        <p class="muted tx__hint">品名と金額の行を入れると、行ごとにカテゴリや税金のフラグを変えられます。値引きはマイナスの金額で入れます。行が無ければ、1行の支出です。</p>

        {rows.length > 0 && (
          <div class="tx__bulk">
            <div class="tx__bulk-row">
              <label for={`${id}-bulkcat`}>すべて同じカテゴリにする</label>
              <CategorySelect id={`${id}-bulkcat`} value={bulkCategory} cats={cats} emptyLabel="カテゴリを選ぶ" onChange={setBulkCategory} />
              <button
                type="button"
                class="btn"
                disabled={busy || bulkCategory === ""}
                onClick={() => {
                  const r = applyBulkCategory(form, rows, bulkCategory);
                  setForm(r.form);
                  setRows(r.rows);
                  setBulkCategory("");
                }}
              >
                すべてに設定
              </button>
            </div>
            <div class="tx__bulk-row">
              <label for={`${id}-bulktax`}>すべて同じ税金フラグにする</label>
              <TaxFlagSelect id={`${id}-bulktax`} value={bulkTax} emptyLabel="フラグを選ぶ" onChange={setBulkTax} />
              <button
                type="button"
                class="btn"
                disabled={busy || bulkTax === ""}
                onClick={() => {
                  const r = applyBulkTaxFlag(form, rows, bulkTax);
                  setForm(r.form);
                  setRows(r.rows);
                  setBulkTax("");
                }}
              >
                すべてに設定
              </button>
            </div>
          </div>
        )}

        <ul class="tx__rows">
          {rows.map((r, i) => (
            <li key={r.key} class="tx__row">
              <div class="tx__row-head">
                <span class="tx__row-no">{i + 1}行目</span>
                <button type="button" class="tx__remove" aria-label={`${i + 1}行目を削除`} disabled={busy} onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}>
                  ×
                </button>
              </div>
              <label for={`${id}-${r.key}-name`}>品名</label>
              <input id={`${id}-${r.key}-name`} type="text" maxLength={100} value={r.name} onInput={(e) => setRow(r.key, { name: (e.currentTarget as HTMLInputElement).value })} />
              <label for={`${id}-${r.key}-amount`}>金額(円。値引きはマイナス)</label>
              <input id={`${id}-${r.key}-amount`} type="text" autoComplete="off" placeholder="例: 198 / -80" value={r.amount} onInput={(e) => setRow(r.key, { amount: (e.currentTarget as HTMLInputElement).value })} />
              <label for={`${id}-${r.key}-cat`}>カテゴリ</label>
              <CategorySelect id={`${id}-${r.key}-cat`} value={r.category} cats={cats} emptyLabel="(取引のカテゴリに従う)" onChange={(category) => setRow(r.key, { category })} />
              <label for={`${id}-${r.key}-tax`}>税金のフラグ</label>
              <TaxFlagSelect id={`${id}-${r.key}-tax`} value={r.tax_flag} emptyLabel="(取引に従う)" onChange={(tax_flag) => setRow(r.key, { tax_flag })} />
              <TaxRateFields id={`${id}-${r.key}`} label="税率(消費税。印字どおり)" choice={r.rate_choice} other={r.rate_other} disabled={busy} onChange={(patch) => setRow(r.key, patch)} />
              <label for={`${id}-${r.key}-taxlabel`}>印字の記号(任意)</label>
              <input id={`${id}-${r.key}-taxlabel`} type="text" maxLength={20} placeholder="例: ※ / 軽" value={r.tax_label} onInput={(e) => setRow(r.key, { tax_label: (e.currentTarget as HTMLInputElement).value })} />
              <label for={`${id}-${r.key}-memo`}>メモ</label>
              <input id={`${id}-${r.key}-memo`} type="text" value={r.memo} onInput={(e) => setRow(r.key, { memo: (e.currentTarget as HTMLInputElement).value })} />
            </li>
          ))}
        </ul>

        <button type="button" class="btn" disabled={busy || rows.length >= MAX_ITEMS} onClick={() => setRows((cur) => [...cur, emptyItemRow(nextKey())])}>
          行を追加
        </button>
        {rows.length >= MAX_ITEMS && <p class="muted tx__hint">明細は{MAX_ITEMS}行までです。</p>}

        <div class={`tx__check${check.ok ? " is-ok" : " is-ng"}`} role="status">
          <span class="num">{check.label}</span>
          {check.hasInvalid && <span class="tx__check-note">品名・金額が未入力、または金額が0・整数でない行があります。</span>}
          {check.rowCount > 0 && !check.ok && !check.hasInvalid && <span class="tx__check-note">合計が合うまで保存できません。</span>}
          {canMatchTotal(check) && (
            <button type="button" class="btn" disabled={busy} onClick={() => setForm((cur) => matchTotal(cur, rows))}>
              合計に合わせる
            </button>
          )}
        </div>
      </fieldset>

      <TaxLinesEditor idPrefix={`${id}-tl`} rows={taxRows} onChange={setTaxRows} nextKey={nextKey} busy={busy} />

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="day__actions">
        <button type="submit" class="btn btn--primary" disabled={busy || !check.ok}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button type="button" class="btn" disabled={busy} onClick={props.onCancel}>
          キャンセル
        </button>
      </div>
    </form>
  );
}

// ---- 削除(ページ内の確認パネル) ----

function DeleteSection(props: { data: TransactionDetailData }) {
  const { transaction: tx, counts } = props.data;
  const [open, setOpen] = useState(false);
  const [withPhotos, setWithPhotos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const id = useRef(`txd-${Math.random().toString(36).slice(2, 8)}`).current;

  async function remove() {
    if (busyRef.current || !canConfirmDelete(counts, withPhotos)) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await run(() => deleteTransaction(tx.id, { deletePhotos: shouldDeletePhotos(counts, withPhotos) }));
      if (!res.ok) {
        setError(res.message);
        return;
      }
      navigate(`/day/${tx.date}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div class="tx__delete">
        <button type="button" class="btn day__danger tx__delete-open" onClick={() => setOpen(true)}>
          この支出を削除
        </button>
      </div>
    );
  }
  return (
    <div class="day__confirm tx__confirm" role="alertdialog" aria-labelledby={`${id}-title`}>
      <p id={`${id}-title`} class="tx__confirm-title">
        {tx.merchant ?? "この支出"}({formatYen(tx.amount)})を削除します。元に戻せません。
      </p>
      <p>消えるもの: {deleteSummary(counts)}</p>
      {counts.photos > 0 && (
        <>
          <label class="tx__check-label" for={`${id}-photos`}>
            <input id={`${id}-photos`} type="checkbox" checked={withPhotos} disabled={busy} onChange={(e) => setWithPhotos((e.currentTarget as HTMLInputElement).checked)} />
            <span>写真もいっしょに削除する</span>
          </label>
          <p class="muted tx__hint">写真が紐づく支出は、写真もいっしょに削除する場合だけ消せます。</p>
        </>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="day__actions">
        <button type="button" class="btn day__danger" disabled={busy || !canConfirmDelete(counts, withPhotos)} onClick={() => void remove()}>
          {busy ? "削除中…" : "削除する"}
        </button>
        <button
          type="button"
          class="btn"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setWithPhotos(false);
            setError(null);
          }}
        >
          やめる
        </button>
      </div>
    </div>
  );
}
