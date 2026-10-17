import { useRef, useState } from "preact/hooks";
import { BrandMark } from "../components/BrandMark";
import { fetchExportText, fetchPhotoBytes, importBackup, putPhotoBytes } from "../api";
import { buildPhotoZips, parsePhotoRecords, readZips, restorePhotos, type BuildSummary, type RestoreSummary } from "../photoBackup";
import {
  errorLines,
  formatFileSize,
  importInChunks,
  planImportChunks,
  summarizeImport,
  validateImportFile,
  validateImportText,
  reportHref,
  reportQuery,
  type ImportChunk,
  type ImportRow,
  type ReportInput,
  type ReportMode,
} from "./backupLogic";
import "./Backup.css";

const DOWNLOAD_ICON = ["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"];
const UPLOAD_ICON = ["M12 15V4", "M7 8l5-5 5 5", "M5 20h14"];

function Icon(props: { d: string[] }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {props.d.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

// 選んだファイルの状態。ok のときだけ「読み込む」を押せる
type Picked =
  | { kind: "none" }
  | { kind: "checking"; name: string; size: number }
  // chunks: サーバーの上限の内側に小分けした塊(大きなファイルは、何回かに分けて送る)
  | { kind: "ready"; name: string; size: number; count: number; chunks: ImportChunk[] }
  | { kind: "invalid"; name: string; size: number; error: string };

type Outcome =
  | { kind: "none" }
  | { kind: "sending"; done: number; total: number }
  | { kind: "error"; message: string }
  | { kind: "done"; rows: ImportRow[] }
  // 途中で止まった(続きは、もう一度「読み込む」を押す。すでに入った分は、重複としてスキップされる)
  | { kind: "stopped"; rows: ImportRow[]; failedAt: number; total: number; message: string };

export function Backup() {
  return (
    <section class="page backup">
      <header class="backup__header">
        <h1 class="backup__title brandmark-line"><BrandMark size={24} />エクスポートとバックアップ</h1>
        <p class="backup__lead">記録は、いつでも自分の手元に取り出せます。バックアップ(JSONL)に写真は含まれません(別に保存してください)。</p>
      </header>

      <div class="backup__pair">
        <section class="backup__card" aria-labelledby="backup-export-h">
          <div class="backup__card-head">
            <h2 id="backup-export-h" class="backup__h2">
              バックアップ(JSONL)
            </h2>
            <p class="backup__desc">全期間の支出・出来事・リンクなどを、1行1件のファイルで書き出します。あとから「読み込む」で元に戻せます。</p>
          </div>
          {/* ファイル名は Content-Disposition(receipt2life-YYYYMMDD.jsonl)に従う */}
          <a class="backup__btn backup__btn--primary" href="/export" download>
            <Icon d={DOWNLOAD_ICON} />
            バックアップをダウンロード
          </a>
        </section>

        <ReportCard />
      </div>

      <ImportCard />
      <PhotoBackupCard />
    </section>
  );
}

const MODES: { value: ReportMode; label: string }[] = [
  { value: "month", label: "月" },
  { value: "year", label: "年" },
  { value: "range", label: "期間" },
];

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 読み物として書き出す(Markdown / HTML)。ブラウザのダウンロードに任せるので、リンクを出すだけ
function ReportCard() {
  const [mode, setMode] = useState<ReportMode>("month");
  const [v, setV] = useState<ReportInput>(() => ({ month: thisMonth(), year: thisMonth().slice(0, 4), from: "", to: "" }));
  const q = reportQuery(mode, v);
  const set = (key: keyof ReportInput) => (e: Event) => setV({ ...v, [key]: (e.currentTarget as HTMLInputElement).value });

  return (
    <section class="backup__card" aria-labelledby="backup-md-h">
      <div class="backup__card-head">
        <h2 id="backup-md-h" class="backup__h2">
          日記として読む(Markdown・HTML)
        </h2>
        <p class="backup__desc">期間を選んで、サマリ・カテゴリ別・カレンダー・期間メモ・日別の記録を1つの文章にまとめます。写真は枚数とキャプションだけです。</p>
      </div>
      <div class="backup__modes" role="radiogroup" aria-label="期間の選び方">
        {MODES.map((m) => (
          <label key={m.value} class={`backup__mode${mode === m.value ? " is-on" : ""}`}>
            <input type="radio" name="report-mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
            {m.label}
          </label>
        ))}
      </div>
      <div class="backup__period">
        {mode === "month" && <input class="backup__input" type="month" aria-label="月" value={v.month} onInput={set("month")} />}
        {mode === "year" && <input class="backup__input" type="number" inputMode="numeric" min="2000" max="2099" aria-label="年" value={v.year} onInput={set("year")} />}
        {mode === "range" && (
          <>
            <input class="backup__input" type="date" aria-label="はじまりの日" value={v.from} onInput={set("from")} />
            <span aria-hidden="true">〜</span>
            <input class="backup__input" type="date" aria-label="終わりの日" value={v.to} onInput={set("to")} />
          </>
        )}
      </div>
      {!q.ok && (
        <p class="backup__hint" role="status">
          {q.error}
        </p>
      )}
      <div class="backup__actions">
        {q.ok ? (
          <>
            <a class="backup__btn backup__btn--primary" href={reportHref("markdown", q.query)} download>
              <Icon d={DOWNLOAD_ICON} />
              Markdown
            </a>
            <a class="backup__btn" href={reportHref("html", q.query)} download>
              <Icon d={DOWNLOAD_ICON} />
              HTML
            </a>
          </>
        ) : (
          <>
            <button type="button" class="backup__btn backup__btn--disabled" disabled>
              Markdown
            </button>
            <button type="button" class="backup__btn backup__btn--disabled" disabled>
              HTML
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function ImportCard() {
  const [picked, setPicked] = useState<Picked>({ kind: "none" });
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  // 同じ描画の中で二重に押されても1回だけ送る
  const sendingRef = useRef(false);

  const sending = outcome.kind === "sending";

  async function onPick(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    setOutcome({ kind: "none" });
    if (!file) {
      setPicked({ kind: "none" });
      return;
    }
    const sizeCheck = validateImportFile(file.size);
    if (!sizeCheck.ok) {
      setPicked({ kind: "invalid", name: file.name, size: file.size, error: sizeCheck.error });
      return;
    }
    setPicked({ kind: "checking", name: file.name, size: file.size });
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPicked({ kind: "invalid", name: file.name, size: file.size, error: "ファイルを読めませんでした。選び直してください。" });
      return;
    }
    const textCheck = validateImportText(text);
    if (!textCheck.ok) setPicked({ kind: "invalid", name: file.name, size: file.size, error: textCheck.error });
    else setPicked({ kind: "ready", name: file.name, size: file.size, count: textCheck.count, chunks: planImportChunks(text) });
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (picked.kind !== "ready" || sendingRef.current) return;
    sendingRef.current = true;
    setOutcome({ kind: "sending", done: 0, total: picked.chunks.length });
    try {
      const res = await importInChunks(picked.chunks, (body) => importBackup(new Blob([body])), {
        onProgress: (done, total) => setOutcome({ kind: "sending", done, total }),
      });
      if (res.kind === "done") setOutcome({ kind: "done", rows: res.rows });
      else setOutcome({ kind: "stopped", rows: res.rows, failedAt: res.failedAt, total: res.total, message: res.message });
    } catch (err) {
      setOutcome({ kind: "error", message: err instanceof Error ? err.message : "読み込みに失敗しました。" });
    } finally {
      sendingRef.current = false;
    }
  }

  const fileLabel =
    picked.kind === "ready"
      ? `${picked.name}(${formatFileSize(picked.size)}・${picked.count.toLocaleString("en-US")}行${picked.chunks.length > 1 ? `・${picked.chunks.length}回に分けて送る` : ""})`
      : picked.kind === "none"
        ? "ファイルはまだ選ばれていません"
        : `${picked.name}(${formatFileSize(picked.size)})`;

  return (
    <section class="backup__card" aria-labelledby="backup-import-h">
      <div class="backup__card-head">
        <h2 id="backup-import-h" class="backup__h2">
          バックアップを読み込む
        </h2>
        <p class="backup__desc">書き出したJSONLを選びます。すでにある記録は上書きせず、重複はスキップします。大きなファイルは、自動で小分けして順に送ります(50MB・10万行まで)。</p>
      </div>

      <form class="backup__import" onSubmit={onSubmit}>
        <label class={`backup__pick${sending ? " is-disabled" : ""}`}>
          <Icon d={UPLOAD_ICON} />
          ファイルを選ぶ
          <input class="backup__file" type="file" accept=".jsonl,.ndjson,application/x-ndjson" disabled={sending} onChange={onPick} />
        </label>
        <span class="backup__filename" aria-live="polite">
          {fileLabel}
        </span>
        <button type="submit" class="backup__btn backup__btn--primary backup__submit" disabled={picked.kind !== "ready" || sending} aria-busy={sending}>
          {outcome.kind === "sending" ? `読み込み中… ${outcome.done} / ${outcome.total}` : "読み込む"}
        </button>
      </form>

      {picked.kind === "invalid" && (
        <p class="backup__error" role="alert">
          {picked.error}
        </p>
      )}
      {outcome.kind === "error" && (
        <p class="backup__error" role="alert">
          {outcome.message}
        </p>
      )}
      {outcome.kind === "stopped" && (
        <p class="backup__error" role="alert">
          {outcome.total}回に分けて送るうち、{outcome.failedAt}回目で止まりました({outcome.message})。もう一度「読み込む」を押すと、続きから戻せます(すでに入った分は、重複としてスキップされ、増えません)。
        </p>
      )}
      {(outcome.kind === "done" || outcome.kind === "stopped") && <ImportResult rows={outcome.rows} />}
    </section>
  );
}

function ImportResult(props: { rows: ImportRow[] }) {
  const c = summarizeImport(props.rows);
  const errs = errorLines(props.rows);
  return (
    <div class="backup__result" role="status" aria-label="読み込み結果">
      <span class="backup__result-title">読み込み結果({c.total}件)</span>
      <div class="backup__counts">
        <div class="backup__count">
          <span>登録</span>
          <b class="num">{c.registered}</b>
        </div>
        <div class="backup__count">
          <span>重複でスキップ</span>
          <b class="num">{c.duplicate}</b>
        </div>
        <div class="backup__count">
          <span>既にある</span>
          <b class="num">{c.exists}</b>
        </div>
        <div class={`backup__count${c.errors > 0 ? " backup__count--warn" : ""}`}>
          <span>読めなかった行</span>
          <b class="num">{c.errors}</b>
        </div>
      </div>
      {errs.items.length > 0 && (
        <>
          <ul class="backup__errors">
            {errs.items.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {errs.more > 0 && <p class="backup__more">ほか{errs.more}件</p>}
        </>
      )}
    </div>
  );
}

const ymd = () => new Date().toISOString().slice(0, 10).replaceAll("-", "");

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type PhotoState =
  | { kind: "idle" }
  | { kind: "working"; label: string; done: number; total: number }
  | { kind: "saved"; summary: BuildSummary }
  | { kind: "restored"; summary: RestoreSummary; zipErrors: string[] }
  | { kind: "error"; message: string };

// 写真のバックアップ(ZIP)。写真は、書き出し(JSONL)には入らないので、別に ZIP で保存する。パソコンでの利用を想定(大きなファイルが何個かできる)
function PhotoBackupCard() {
  const [state, setState] = useState<PhotoState>({ kind: "idle" });
  const [files, setFiles] = useState<File[]>([]);
  const busyRef = useRef(false);
  const working = state.kind === "working";

  async function onDownload() {
    if (busyRef.current) return;
    busyRef.current = true;
    setState({ kind: "working", label: "写真の一覧を読み込み中…", done: 0, total: 0 });
    try {
      const records = parsePhotoRecords(await fetchExportText());
      if (records.length === 0) {
        setState({ kind: "error", message: "写真はまだありません。" });
        return;
      }
      const base = `receipt2life-photos-${ymd()}`;
      const summary = await buildPhotoZips(records, fetchPhotoBytes, {
        onProgress: (done, total) => setState({ kind: "working", label: "写真を取り出し中…", done, total }),
        // できた部品を、そのつど保存する(メモリに溜めない)。ブラウザが「複数のダウンロード」の許可を求めたら、許可してください
        onPart: (part) => saveBlob(part.blob, `${base}-part${part.index}.zip`),
      });
      setState({ kind: "saved", summary });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "写真を保存できませんでした。" });
    } finally {
      busyRef.current = false;
    }
  }

  async function onRestore(e: Event) {
    e.preventDefault();
    if (busyRef.current || files.length === 0) return;
    busyRef.current = true;
    setState({ kind: "working", label: "ZIP を読み込み中…", done: 0, total: 0 });
    try {
      const { entries, errors } = await readZips(files, files.map((f) => f.name));
      const summary = await restorePhotos(entries, putPhotoBytes, { onProgress: (done, total) => setState({ kind: "working", label: "写真を戻し中…", done, total }) });
      setState({ kind: "restored", summary, zipErrors: errors });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "写真を戻せませんでした。" });
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <section class="backup__card" aria-labelledby="backup-photo-h">
      <div class="backup__card-head">
        <h2 id="backup-photo-h" class="backup__h2">
          写真のバックアップ(ZIP)
        </h2>
        <p class="backup__desc">写真は、上のバックアップ(JSONL)には入りません。ここで、ZIP に保存します(100MBか500枚ごとに、複数のファイルになります)。パソコンでの利用を想定しています。</p>
      </div>
      <button type="button" class="backup__btn backup__btn--primary" disabled={working} aria-busy={working} onClick={() => void onDownload()}>
        <Icon d={DOWNLOAD_ICON} />
        写真をダウンロード(ZIP)
      </button>

      <form class="backup__import" onSubmit={onRestore}>
        <label class={`backup__pick${working ? " is-disabled" : ""}`}>
          <Icon d={UPLOAD_ICON} />
          ZIP を選ぶ(複数可)
          <input class="backup__file" type="file" multiple accept=".zip,application/zip" disabled={working} onChange={(e) => setFiles(Array.from((e.currentTarget as HTMLInputElement).files ?? []))} />
        </label>
        <span class="backup__filename" aria-live="polite">
          {files.length === 0 ? "ファイルはまだ選ばれていません" : `${files.length}個(${formatFileSize(files.reduce((s, f) => s + f.size, 0))})`}
        </span>
        <button type="submit" class="backup__btn backup__btn--primary backup__submit" disabled={working || files.length === 0}>
          写真を戻す
        </button>
      </form>
      <p class="backup__desc">写真を戻す前に、上の「バックアップを読み込む」で、バックアップ(JSONL)を読み込んでください(写真の日付・キャプション・紐づけ先は、そちらから戻ります)。すでにある写真は、上書きしません。</p>

      {state.kind === "working" && (
        <p class="backup__desc" role="status">
          {state.label}
          {state.total > 0 ? ` ${state.done} / ${state.total}` : ""}
        </p>
      )}
      {state.kind === "error" && (
        <p class="backup__error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "saved" && (
        <div class="backup__result" role="status" aria-label="写真の保存結果">
          <span class="backup__result-title">
            {state.summary.saved}枚を、{state.summary.parts}個の ZIP に保存しました(全{state.summary.total}枚)
          </span>
          {state.summary.failed.length > 0 && (
            <ul class="backup__errors">
              {state.summary.failed.slice(0, 50).map((f) => (
                <li key={f.id}>
                  {f.id}: {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state.kind === "restored" && (
        <div class="backup__result" role="status" aria-label="写真を戻した結果">
          <span class="backup__result-title">写真を戻した結果({state.summary.total}枚)</span>
          <div class="backup__counts">
            <div class="backup__count">
              <span>戻した</span>
              <b class="num">{state.summary.restored}</b>
            </div>
            <div class="backup__count">
              <span>すでにある</span>
              <b class="num">{state.summary.exists}</b>
            </div>
            <div class={`backup__count${state.summary.noRecord > 0 ? " backup__count--warn" : ""}`}>
              <span>情報がない</span>
              <b class="num">{state.summary.noRecord}</b>
            </div>
            <div class={`backup__count${state.summary.failed.length > 0 ? " backup__count--warn" : ""}`}>
              <span>戻せなかった</span>
              <b class="num">{state.summary.failed.length}</b>
            </div>
          </div>
          {state.summary.noRecord > 0 && <p class="backup__more">「情報がない」は、バックアップ(JSONL)を、まだ読み込んでいない写真です。JSONL を読み込んでから、もう一度戻してください。</p>}
          {state.summary.stoppedBy && <p class="backup__error">途中で止まりました(通信の失敗など: {state.summary.stoppedBy})。もう一度戻すと、続きから戻せます(すでにある写真は上書きしません)。</p>}
          {[...state.zipErrors, ...state.summary.failed.slice(0, 50).map((f) => `${f.name}: ${f.reason}`)].length > 0 && (
            <ul class="backup__errors">
              {[...state.zipErrors, ...state.summary.failed.slice(0, 50).map((f) => `${f.name}: ${f.reason}`)].map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
