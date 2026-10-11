import { useEffect, useRef, useState } from "preact/hooks";
import type { ApiResult, CategoriesData, DayData, EventColor, EventView, FieldError, PhotoView, TransactionView } from "../../../src/api/contract";
import {
  UnauthorizedError,
  addEvent,
  addTransactions,
  deleteEvent,
  deletePhoto,
  deleteTransaction,
  getCategories,
  getDay,
  photoUrl,
  updateEvent,
  updateTransaction,
} from "../api";
import { formatYen, monthOf, todayJst, weekdayIndex } from "../format";
import { DELETE_CONCURRENCY, runWithLimit, summarizeResults } from "../photo-queue";
import { PhotoUploader } from "../components/PhotoUploader";
import { Link } from "../router";
import "./Day.css";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const COLORS: { value: EventColor; label: string; hex: string }[] = [
  { value: "red", label: "赤", hex: "#C94B3F" },
  { value: "orange", label: "橙", hex: "#D9822B" },
  { value: "green", label: "緑", hex: "#3E9B68" },
  { value: "blue", label: "青", hex: "#3B73C9" },
  { value: "purple", label: "紫", hex: "#7C5BB5" },
];

// "2026-10-11" → "10月11日(日)"
function formatShort(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}月${Number(d)}日(${WEEKDAYS[weekdayIndex(date)]})`;
}

function messageOf(errors: FieldError[]): string {
  return errors.map((e) => e.message).join(" / ") || "うまくいきませんでした。";
}

// API 呼び出しの結果を、成功なら値、失敗なら日本語のメッセージにそろえる
async function run<T>(call: () => Promise<ApiResult<T>>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const res = await call();
    if (res.ok) return { ok: true, value: res };
    return { ok: false, message: messageOf(res.errors) };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, message: e.message };
    return { ok: false, message: e instanceof Error ? e.message : "通信に失敗しました。" };
  }
}

const optional = (s: string): string | undefined => (s.trim() === "" ? undefined : s.trim());
const nullable = (s: string): string | null => (s.trim() === "" ? null : s.trim());

function parseAmount(s: string): number | null {
  const t = s.trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

export function Day(props: { date: string }) {
  const { date } = props;
  const [data, setData] = useState<DayData | null>(null);
  const [cats, setCats] = useState<CategoriesData>({ categories: [], accounts: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editingTx, setEditingTx] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingEvent, setEditingEvent] = useState<string | "new" | null>(null);
  const [viewPhoto, setViewPhoto] = useState<PhotoView | null>(null);
  const [confirmPhotoDelete, setConfirmPhotoDelete] = useState(false);

  async function load() {
    const res = await run(() => getDay(date));
    if (res.ok) {
      setData(res.value);
      setLoadError(null);
    } else {
      setLoadError(res.message);
    }
  }

  useEffect(() => {
    setData(null);
    setEditingTx(null);
    setAdding(false);
    setEditingEvent(null);
    setNotice(null);
    setError(null);
    void load();
  }, [date]);

  useEffect(() => {
    void run(() => getCategories()).then((res) => {
      if (res.ok) setCats(res.value);
    });
  }, []);

  useEffect(() => {
    if (!viewPhoto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewPhoto]);

  // 保存中の二重送信を防ぐ。成功したら true
  async function guarded(action: () => Promise<string | null>, successNotice?: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const failure = await action();
      if (failure) {
        setError(failure);
        return false;
      }
      if (successNotice) setNotice(successNotice);
      await load();
      return true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const failOf = (res: { ok: true; value: unknown } | { ok: false; message: string }) => (res.ok ? null : res.message);

  async function saveTx(id: string, form: TxForm): Promise<boolean> {
    const amount = parseAmount(form.amount);
    if (amount === null) {
      setError("金額は整数(円)で入力してください。");
      return false;
    }
    const ok = await guarded(
      async () => failOf(await run(() => updateTransaction(id, { amount, merchant: nullable(form.merchant), category: nullable(form.category), account: nullable(form.account), memo: nullable(form.memo) }))),
      "支出を保存しました。",
    );
    if (ok) setEditingTx(null);
    return ok;
  }

  async function removeTx(tx: TransactionView) {
    if (!window.confirm(`${tx.merchant ?? "この支出"}(${formatYen(tx.amount)})を削除しますか?`)) return;
    const ok = await guarded(async () => failOf(await run(() => deleteTransaction(tx.id))), "支出を削除しました。");
    if (ok) setEditingTx(null);
  }

  async function addTx(form: TxForm): Promise<boolean> {
    const amount = parseAmount(form.amount);
    if (amount === null) {
      setError("金額は整数(円)で入力してください。");
      return false;
    }
    const ok = await guarded(
      async () =>
        failOf(
          await run(() =>
            addTransactions([{ date, amount, merchant: optional(form.merchant), category: optional(form.category), account: optional(form.account), memo: optional(form.memo), source: "manual", allow_duplicate: true }]),
          ),
        ),
      "支出を追加しました。",
    );
    if (ok) setAdding(false);
    return ok;
  }

  async function saveEvent(id: string | "new", form: EventForm): Promise<boolean> {
    const title = form.title.trim();
    if (!title) {
      setError("メモの内容を入力してください。");
      return false;
    }
    if (!form.start) {
      setError("開始日を入力してください。");
      return false;
    }
    if (form.end && form.end < form.start) {
      setError("終了日は開始日以降にしてください。");
      return false;
    }
    const ok = await guarded(
      async () =>
        failOf(
          id === "new"
            ? await run(() => addEvent({ title, start_date: form.start, end_date: form.end && form.end !== form.start ? form.end : undefined, color: form.color }))
            : await run(() => updateEvent(id, { title, start_date: form.start, end_date: form.end && form.end !== form.start ? form.end : null, color: form.color })),
        ),
      "メモを保存しました。",
    );
    if (ok) setEditingEvent(null);
    return ok;
  }

  async function removeEvent(ev: EventView) {
    if (!window.confirm(`メモ「${ev.title}」を削除しますか?`)) return;
    const ok = await guarded(async () => failOf(await run(() => deleteEvent(ev.id))), "メモを削除しました。");
    if (ok) setEditingEvent(null);
  }

  async function removePhoto(photo: PhotoView) {
    const ok = await guarded(async () => failOf(await run(() => deletePhoto(photo.id))), "写真を削除しました。");
    if (ok) closeLightbox();
    else setConfirmPhotoDelete(false);
  }

  function closeLightbox() {
    setViewPhoto(null);
    setConfirmPhotoDelete(false);
  }

  const today = todayJst();
  const month = monthOf(date);

  return (
    <section class="page day">
      <header class="day__head">
        <Link href={`/calendar?month=${month}`} class="day__back" aria-label="カレンダーに戻る">
          ‹ 戻る
        </Link>
        <h1 class="page__title day__title">{formatShort(date)}</h1>
        <Link href={`/day/${today}`} class="day__today">
          今日
        </Link>
      </header>

      {loadError && (
        <p class="error" role="alert">
          {loadError}
        </p>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p class="day__notice" role="status">
          {notice}
        </p>
      )}
      {!data && !loadError && <p class="muted">読み込み中…</p>}

      {data && (
        <>
          <div class="card day__total">
            <span class="muted">この日の合計</span>
            <strong class="num day__total-amount">{formatYen(data.total)}</strong>
            <span class="muted">{data.count}件</span>
          </div>

          <div class="card">
            <div class="day__row-head">
              <h2 class="day__h">支出</h2>
              {!adding && (
                <button type="button" class="btn" disabled={busy} onClick={() => setAdding(true)}>
                  支出を追加
                </button>
              )}
            </div>
            {adding && <TxFormView title="支出を追加" initial={emptyTx} cats={cats} busy={busy} onSubmit={addTx} onCancel={() => setAdding(false)} />}
            {data.transactions.length === 0 && !adding && <p class="muted">この日の支出はありません。</p>}
            <ul class="day__list">
              {data.transactions.map((tx) => (
                <li key={tx.id} class="day__item">
                  {editingTx === tx.id ? (
                    <TxFormView
                      title="支出を編集"
                      initial={{ amount: String(tx.amount), merchant: tx.merchant ?? "", category: tx.category ?? "", account: tx.account ?? "", memo: tx.memo ?? "" }}
                      cats={cats}
                      busy={busy}
                      onSubmit={(f) => saveTx(tx.id, f)}
                      onCancel={() => setEditingTx(null)}
                      onDelete={() => removeTx(tx)}
                    />
                  ) : (
                    <button type="button" class="day__tx" onClick={() => setEditingTx(tx.id)} aria-label={`${tx.merchant ?? "店名なし"} ${formatYen(tx.amount)} を編集`}>
                      <span class="day__tx-main">
                        <span class="day__merchant">{tx.merchant ?? "(店名なし)"}</span>
                        <span class="day__tags">
                          {categoryTags(tx.category, cats).map((t) => (
                            <span class="chip" key={t}>
                              {t}
                            </span>
                          ))}
                          {tx.account && <span class="chip">{tx.account}</span>}
                          {tx.status === "needs_review" && <span class="chip chip--warn">要確認</span>}
                        </span>
                        {tx.memo && <span class="muted day__memo">{tx.memo}</span>}
                      </span>
                      <span class="num day__amount">{formatYen(tx.amount)}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div class="card">
            <div class="day__row-head">
              <h2 class="day__h">この日のメモ</h2>
              {editingEvent === null && (
                <button type="button" class="btn" disabled={busy} onClick={() => setEditingEvent("new")}>
                  メモを追加
                </button>
              )}
            </div>
            {editingEvent === "new" && <EventFormView initial={{ title: "", start: date, end: "", color: "blue" }} busy={busy} onSubmit={(f) => saveEvent("new", f)} onCancel={() => setEditingEvent(null)} />}
            {data.events.length === 0 && editingEvent === null && <p class="muted">この日のメモはありません。</p>}
            <ul class="day__list">
              {data.events.map((ev) => (
                <li key={ev.id} class="day__item">
                  {editingEvent === ev.id ? (
                    <EventFormView
                      initial={{ title: ev.title, start: ev.start_date, end: ev.end_date ?? "", color: ev.color }}
                      busy={busy}
                      onSubmit={(f) => saveEvent(ev.id, f)}
                      onCancel={() => setEditingEvent(null)}
                      onDelete={() => removeEvent(ev)}
                    />
                  ) : (
                    <button type="button" class={`day__event day__event--${ev.color}`} onClick={() => setEditingEvent(ev.id)} aria-label={`メモ「${ev.title}」を編集`}>
                      <span class="day__event-title">{ev.title}</span>
                      {ev.note && <span class="muted day__memo">{ev.note}</span>}
                      <span class="muted day__event-range">{ev.end_date && ev.end_date !== ev.start_date ? `${formatShort(ev.start_date)} 〜 ${formatShort(ev.end_date)}` : formatShort(ev.start_date)}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <PhotosCard date={date} photos={data.photos} disabled={busy} onView={setViewPhoto} onChanged={load} />
        </>
      )}

      {viewPhoto && (
        <div class="day__lightbox" role="dialog" aria-modal="true" aria-label="写真の拡大表示" onClick={closeLightbox}>
          <img src={photoUrl(viewPhoto.id)} alt={viewPhoto.caption ?? ""} onClick={(e) => e.stopPropagation()} />
          <div class="day__lightbox-bar" onClick={(e) => e.stopPropagation()}>
            {confirmPhotoDelete ? (
              <>
                <span class="day__lightbox-ask" role="alert">
                  この写真を削除しますか?
                </span>
                <button type="button" class="btn day__danger" disabled={busy} onClick={() => removePhoto(viewPhoto)}>
                  削除する
                </button>
                <button type="button" class="btn" disabled={busy} onClick={() => setConfirmPhotoDelete(false)}>
                  やめる
                </button>
              </>
            ) : (
              <>
                <button type="button" class="btn" onClick={closeLightbox}>
                  閉じる
                </button>
                <button type="button" class="btn day__danger" disabled={busy} onClick={() => setConfirmPhotoDelete(true)}>
                  削除
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// 写真エリア。複数アップロード(PhotoUploader)と複数削除(選択モード)
function PhotosCard(props: { date: string; photos: PhotoView[]; disabled: boolean; onView: (p: PhotoView) => void; onChanged: () => Promise<void> }) {
  const { date, photos, disabled } = props;
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const off = disabled || uploading || deleting;

  // 再読み込みで無くなった写真は選択から外す
  useEffect(() => {
    setSelected((cur) => {
      const ids = new Set(photos.map((p) => p.id));
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [photos]);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function leaveSelect() {
    setSelecting(false);
    setConfirming(false);
    setSelected(new Set());
  }

  async function deleteSelected() {
    const targets = photos.map((p, i) => ({ p, label: p.caption || `写真${i + 1}` })).filter((x) => selected.has(x.p.id));
    if (targets.length === 0 || disabled || uploading || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setResultMsg(null);
    setFailures([]);
    setConfirming(false);
    setClearSignal((n) => n + 1);
    try {
      const settled = await runWithLimit(targets, DELETE_CONCURRENCY, async (t) => {
        const res = await run(() => deletePhoto(t.p.id));
        return res.ok ? null : res.message;
      });
      const results = targets.map((t, i) => {
        const s = settled[i];
        return { id: t.p.id, name: t.label, error: s?.status === "fulfilled" ? s.value : "削除できませんでした。" };
      });
      const summary = summarizeResults("削除", results);
      setResultMsg(summary.message);
      setFailures(summary.failures);
      // 失敗分は選択状態のまま残す
      const failedIds = new Set(results.filter((x) => x.error !== null).map((x) => x.id));
      setSelected(failedIds);
      if (failedIds.size === 0) setSelecting(false);
      await props.onChanged();
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <PhotoUploader
      meta={{ date }}
      title="写真"
      disabled={disabled || deleting}
      clearSignal={clearSignal}
      onBusyChange={setUploading}
      onStart={() => {
        setSelecting(false);
        setConfirming(false);
        setSelected(new Set());
        setResultMsg(null);
        setFailures([]);
      }}
      onDone={() => props.onChanged()}
      tools={
        photos.length > 0 && (
          <button type="button" class="btn" disabled={off} aria-pressed={selecting} onClick={() => (selecting ? leaveSelect() : setSelecting(true))}>
            {selecting ? "選択をやめる" : "選択"}
          </button>
        )
      }
      status={resultMsg && <p class="day__result">{resultMsg}</p>}
    >
      {failures.length > 0 && (
        <ul class="day__queue" aria-label="失敗した写真">
          {failures.map((f, i) => (
            <li key={i} class="day__queue-item is-failed">
              <span class="day__queue-name">{f.name}</span>
              <span class="day__queue-error">{f.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {selecting && (
        <div class="day__selbar">
          <span class="day__selcount">{selected.size}枚選択中</span>
          <button type="button" class="btn" disabled={off} onClick={() => setSelected(new Set(photos.map((p) => p.id)))}>
            すべて選択
          </button>
          <button type="button" class="btn" disabled={off || selected.size === 0} onClick={() => setSelected(new Set())}>
            選択を解除
          </button>
          <button type="button" class="btn day__danger" disabled={off || selected.size === 0} onClick={() => setConfirming(true)}>
            {selected.size}枚を削除
          </button>
        </div>
      )}
      {selecting && confirming && (
        <div class="day__confirm" role="alertdialog" aria-label="写真の削除の確認">
          <p>{selected.size}枚の写真を削除します。元に戻せません。よろしいですか?</p>
          <div class="day__actions">
            <button type="button" class="btn day__danger" disabled={off} onClick={() => void deleteSelected()}>
              {selected.size}枚を削除する
            </button>
            <button type="button" class="btn" disabled={off} onClick={() => setConfirming(false)}>
              やめる
            </button>
          </div>
        </div>
      )}

      {deleting && <p class="muted">処理中…</p>}
      {photos.length === 0 && <p class="muted">この日の写真はありません。</p>}
      <ul class="day__photos">
        {photos.map((p) => {
          const on = selected.has(p.id);
          return (
            <li key={p.id} class="day__photo">
              <button
                type="button"
                class="day__thumb"
                onClick={() => (selecting ? toggle(p.id) : props.onView(p))}
                aria-label={selecting ? (p.caption ? `写真を選択: ${p.caption}` : "写真を選択") : p.caption ? `写真を拡大: ${p.caption}` : "写真を拡大"}
                aria-pressed={selecting ? on : undefined}
                disabled={selecting && off}
              >
                <img src={photoUrl(p.id)} alt={p.caption ?? ""} loading="lazy" />
                {selecting && (
                  <span class={`day__check${on ? " is-on" : ""}`} aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </PhotoUploader>
  );
}

// 「大分類 › カテゴリ」をタグにする。大分類が分からなければカテゴリ名だけ
function categoryTags(category: string | null, cats: CategoriesData): string[] {
  if (!category) return [];
  const found = cats.categories.find((c) => c.name === category);
  return found && found.group_name !== category ? [found.group_name, category] : [category];
}

interface TxForm {
  amount: string;
  merchant: string;
  category: string;
  account: string;
  memo: string;
}
const emptyTx: TxForm = { amount: "", merchant: "", category: "", account: "", memo: "" };

function TxFormView(props: { title: string; initial: TxForm; cats: CategoriesData; busy: boolean; onSubmit: (f: TxForm) => Promise<boolean>; onCancel: () => void; onDelete?: () => void }) {
  const { initial, cats, busy } = props;
  const [f, setF] = useState<TxForm>(initial);
  const set = (k: keyof TxForm) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });
  const groups = new Map<string, string[]>();
  for (const c of cats.categories) groups.set(c.group_name, [...(groups.get(c.group_name) ?? []), c.name]);
  const known = cats.categories.some((c) => c.name === f.category);
  const accountKnown = cats.accounts.includes(f.account);
  const id = useRef(`tx-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <form
      class="day__form"
      onSubmit={(e) => {
        e.preventDefault();
        void props.onSubmit(f);
      }}
    >
      <h3 class="day__form-title">{props.title}</h3>
      <label for={`${id}-amount`}>金額(円)</label>
      <input id={`${id}-amount`} type="text" inputMode="numeric" required value={f.amount} onInput={set("amount")} />
      <label for={`${id}-merchant`}>店名</label>
      <input id={`${id}-merchant`} type="text" value={f.merchant} onInput={set("merchant")} />
      <label for={`${id}-category`}>カテゴリ</label>
      <select id={`${id}-category`} value={f.category} onChange={set("category")}>
        <option value="">未設定</option>
        {f.category && !known && <option value={f.category}>{f.category}</option>}
        {[...groups.entries()].map(([group, names]) => (
          <optgroup label={group} key={group}>
            {names.map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <label for={`${id}-account`}>口座</label>
      <select id={`${id}-account`} value={f.account} onChange={set("account")}>
        <option value="">未設定</option>
        {f.account && !accountKnown && <option value={f.account}>{f.account}</option>}
        {cats.accounts.map((a) => (
          <option value={a} key={a}>
            {a}
          </option>
        ))}
      </select>
      <label for={`${id}-memo`}>メモ</label>
      <textarea id={`${id}-memo`} rows={2} value={f.memo} onInput={set("memo")} />
      <div class="day__actions">
        <button type="submit" class="btn btn--primary" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button type="button" class="btn" disabled={busy} onClick={props.onCancel}>
          キャンセル
        </button>
        {props.onDelete && (
          <button type="button" class="btn day__danger" disabled={busy} onClick={props.onDelete}>
            削除
          </button>
        )}
      </div>
    </form>
  );
}

interface EventForm {
  title: string;
  start: string;
  end: string;
  color: EventColor;
}

function EventFormView(props: { initial: EventForm; busy: boolean; onSubmit: (f: EventForm) => Promise<boolean>; onCancel: () => void; onDelete?: () => void }) {
  const { busy } = props;
  const [f, setF] = useState<EventForm>(props.initial);
  const id = useRef(`ev-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <form
      class="day__form"
      onSubmit={(e) => {
        e.preventDefault();
        void props.onSubmit(f);
      }}
    >
      <label for={`${id}-title`}>メモ</label>
      <textarea id={`${id}-title`} rows={3} required value={f.title} onInput={(e) => setF({ ...f, title: (e.currentTarget as HTMLTextAreaElement).value })} />
      <div role="group" aria-label="色" class="day__colors">
        {COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            class={`day__color${f.color === c.value ? " is-selected" : ""}`}
            style={{ "--swatch": c.hex }}
            aria-pressed={f.color === c.value}
            onClick={() => setF({ ...f, color: c.value })}
          >
            <span class="day__swatch" aria-hidden="true" />
            <span>{c.label}</span>
          </button>
        ))}
      </div>
      <div class="day__dates">
        <div>
          <label for={`${id}-start`}>開始日</label>
          <input id={`${id}-start`} type="date" required value={f.start} onInput={(e) => setF({ ...f, start: (e.currentTarget as HTMLInputElement).value })} />
        </div>
        <div>
          <label for={`${id}-end`}>終了日(省略で1日)</label>
          <input id={`${id}-end`} type="date" value={f.end} min={f.start} onInput={(e) => setF({ ...f, end: (e.currentTarget as HTMLInputElement).value })} />
        </div>
      </div>
      <div class="day__actions">
        <button type="submit" class="btn btn--primary" disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button type="button" class="btn" disabled={busy} onClick={props.onCancel}>
          キャンセル
        </button>
        {props.onDelete && (
          <button type="button" class="btn day__danger" disabled={busy} onClick={props.onDelete}>
            削除
          </button>
        )}
      </div>
    </form>
  );
}
