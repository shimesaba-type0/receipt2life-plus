import { useRef, useState } from "preact/hooks";
import type { SeatRecordView, VenueSummary } from "../../../src/api/contract";
import {
  RATINGS,
  SEAT_LIMITS,
  emptySeatForm,
  ratingLabel,
  ratingSpoken,
  seatHeadLines,
  screenSuggestions,
  seatFormFromRecord,
  seatRecordSummary,
  toggleRating,
  venueSuggestions,
  type SeatFormValues,
} from "../pages/seatRecordLogic";
import "./SeatRecordsCard.css";

// 座席の記録1件の表示(日の詳細とPCの詳細ペインで共通)。評価は「★4」の文字で出す(色に頼らない)
// 行は、作品名(太字)→会場名→スクリーン名(あれば。特徴 note があれば小さく添える)→座席と評価→一言。会場とスクリーンは別の行にする
export function SeatRecordLine(props: { record: SeatRecordView }) {
  const { record } = props;
  const head = seatHeadLines(record);
  return (
    <>
      {head.title && <strong class="seat__title">{head.title}</strong>}
      <span class={`seat__venue${head.title ? "" : " seat__venue--head"}`}>{head.venue}</span>
      {head.screen && (
        <span class="seat__screen">
          {head.screen}
          {head.screenNote && <small class="seat__screen-note muted">{head.screenNote}</small>}
        </span>
      )}
      <span class="seat__line">
        <strong class="seat__seat num">{record.seat}</strong>
        <span class="seat__rating num" aria-label={ratingSpoken(record.rating)}>
          {ratingLabel(record.rating)}
        </span>
      </span>
      {record.note && <span class="seat__note muted">{record.note}</span>}
    </>
  );
}

function SeatForm(props: {
  initial: SeatFormValues;
  venues: VenueSummary[];
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (f: SeatFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { busy } = props;
  const [f, setF] = useState<SeatFormValues>(props.initial);
  const id = useRef(`st-${Math.random().toString(36).slice(2, 8)}`).current;
  const venues = venueSuggestions(props.venues);
  const screens = screenSuggestions(props.venues, f.venue);
  return (
    <form
      class="day__form seat__form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(f);
      }}
    >
      <label for={`${id}-title`}>作品名・公演名(任意)</label>
      <input
        id={`${id}-title`}
        type="text"
        maxLength={SEAT_LIMITS.title}
        autoComplete="off"
        placeholder="例: 映画のタイトル、ライブ名"
        value={f.title}
        onInput={(e) => setF({ ...f, title: (e.currentTarget as HTMLInputElement).value })}
      />
      <label for={`${id}-venue`}>会場名</label>
      <input
        id={`${id}-venue`}
        type="text"
        list={`${id}-venues`}
        required
        maxLength={SEAT_LIMITS.venue}
        autoComplete="off"
        placeholder="例: A映画館(候補から選ぶか、入力)"
        value={f.venue}
        onInput={(e) => setF({ ...f, venue: (e.currentTarget as HTMLInputElement).value })}
      />
      <datalist id={`${id}-venues`}>
        {venues.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <label for={`${id}-screen`}>スクリーン・ホール(任意)</label>
      <input
        id={`${id}-screen`}
        type="text"
        list={`${id}-screens`}
        maxLength={SEAT_LIMITS.screen}
        autoComplete="off"
        placeholder="例: スクリーン5"
        value={f.screen}
        onInput={(e) => setF({ ...f, screen: (e.currentTarget as HTMLInputElement).value })}
      />
      <datalist id={`${id}-screens`}>
        {screens.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <label for={`${id}-seat`}>座席</label>
      <input
        id={`${id}-seat`}
        type="text"
        required
        maxLength={SEAT_LIMITS.seat}
        autoComplete="off"
        placeholder="例: F-5"
        value={f.seat}
        onInput={(e) => setF({ ...f, seat: (e.currentTarget as HTMLInputElement).value })}
      />
      <span class="seat__label" id={`${id}-rating`}>
        評価(任意。5が最良。もう一度押すと外れる)
      </span>
      <div class="seat__ratings" role="group" aria-labelledby={`${id}-rating`}>
        {RATINGS.map((n) => (
          <button
            key={n}
            type="button"
            class={`seat__star${f.rating === n ? " is-selected" : ""}`}
            aria-pressed={f.rating === n}
            aria-label={`評価${n}`}
            onClick={() => setF({ ...f, rating: toggleRating(f.rating, n) })}
          >
            ★{n}
          </button>
        ))}
      </div>
      <label for={`${id}-note`}>一言(任意)</label>
      <input
        id={`${id}-note`}
        type="text"
        maxLength={SEAT_LIMITS.note}
        autoComplete="off"
        placeholder="例: 前すぎて首が疲れた"
        value={f.note}
        onInput={(e) => setF({ ...f, note: (e.currentTarget as HTMLInputElement).value })}
      />
      {props.error && (
        <p class="error" role="alert">
          {props.error}
        </p>
      )}
      <div class="day__actions">
        <button type="submit" class="btn btn--primary" disabled={busy}>
          {busy ? "保存中…" : props.submitLabel}
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

// 日の詳細の「座席の記録」。追加・編集・削除ができる。エラーはフォームの近くに出す(失敗は文言を返す。成功は null)
export function SeatRecordsCard(props: {
  records: SeatRecordView[];
  // 会場名・スクリーン名の候補のもと(登録済みの会場と、その下のスクリーン)
  venues: VenueSummary[];
  busy: boolean;
  onAdd: (f: SeatFormValues) => Promise<string | null>;
  onUpdate: (id: string, f: SeatFormValues) => Promise<string | null>;
  onDelete: (record: SeatRecordView) => Promise<string | null>;
}) {
  const { records, busy } = props;
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const close = () => {
    setEditing(null);
    setFormError(null);
  };
  const finish = (failure: string | null) => {
    if (failure) setFormError(failure);
    else close();
  };

  return (
    <div class="card">
      <div class="day__row-head day__row-head--sub">
        <h2 class="day__h">座席の記録</h2>
        <span class="muted day__sub">映画館などの席の評価</span>
        {editing === null && (
          <div class="day__photo-tools">
            <button type="button" class="btn" disabled={busy} onClick={() => setEditing("new")}>
              座席を記録
            </button>
          </div>
        )}
      </div>
      {editing === "new" && (
        <SeatForm
          initial={emptySeatForm(records[records.length - 1]?.venue ?? "")}
          venues={props.venues}
          busy={busy}
          error={formError}
          submitLabel="追加"
          onSubmit={async (f) => finish(await props.onAdd(f))}
          onCancel={close}
        />
      )}
      {records.length === 0 && editing === null && <p class="muted">この日の座席の記録はありません。</p>}
      {records.length > 0 && (
        <ul class="day__list seat__list">
          {records.map((r) => (
            <li key={r.id} class="day__item">
              {editing === r.id ? (
                <SeatForm
                  initial={seatFormFromRecord(r)}
                  venues={props.venues}
                  busy={busy}
                  error={formError}
                  submitLabel="保存"
                  onSubmit={async (f) => finish(await props.onUpdate(r.id, f))}
                  onCancel={close}
                  onDelete={async () => {
                    if (!window.confirm(`座席の記録「${seatRecordSummary(r)}」を削除しますか?`)) return;
                    finish(await props.onDelete(r));
                  }}
                />
              ) : (
                <button
                  type="button"
                  class="seat__row"
                  disabled={busy || editing !== null}
                  onClick={() => {
                    setFormError(null);
                    setEditing(r.id);
                  }}
                  aria-label={`座席の記録「${seatRecordSummary(r)}」を編集`}
                >
                  <SeatRecordLine record={r} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
