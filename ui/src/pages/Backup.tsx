import { useRef, useState } from "preact/hooks";
import { BrandMark } from "../components/BrandMark";
import { importBackup } from "../api";
import {
  errorLines,
  formatFileSize,
  importHttpError,
  summarizeImport,
  validateImportFile,
  validateImportText,
  type ImportRow,
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
type Picked = { kind: "none" } | { kind: "checking"; name: string; size: number } | { kind: "ready"; file: File; count: number } | { kind: "invalid"; name: string; size: number; error: string };

type Outcome = { kind: "none" } | { kind: "sending" } | { kind: "error"; message: string } | { kind: "done"; rows: ImportRow[] };

export function Backup() {
  return (
    <section class="page backup">
      <header class="backup__header">
        <h1 class="backup__title brandmark-line"><BrandMark size={24} />エクスポートとバックアップ</h1>
        <p class="backup__lead">記録は、いつでも自分の手元に取り出せます。写真は含まれません(別に保存してください)。</p>
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

        <section class="backup__card" aria-labelledby="backup-md-h">
          <div class="backup__card-head backup__card-head--row">
            <h2 id="backup-md-h" class="backup__h2">
              日記として読む(Markdown)
            </h2>
            <span class="backup__badge">準備中</span>
          </div>
          <p class="backup__desc">月ごとに、日付・支出・出来事のメモを1つの文章にまとめます。ほかのメモアプリで読むのに向いています。</p>
          <button type="button" class="backup__btn backup__btn--disabled" disabled aria-describedby="backup-md-h">
            Markdownをダウンロード
          </button>
        </section>
      </div>

      <ImportCard />
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
    else setPicked({ kind: "ready", file, count: textCheck.count });
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (picked.kind !== "ready" || sendingRef.current) return;
    sendingRef.current = true;
    setOutcome({ kind: "sending" });
    try {
      const res = await importBackup(picked.file);
      if (res.ok) setOutcome({ kind: "done", rows: res.results });
      else setOutcome({ kind: "error", message: importHttpError(res.status, res.error) });
    } catch (err) {
      setOutcome({ kind: "error", message: err instanceof Error ? err.message : "読み込みに失敗しました。" });
    } finally {
      sendingRef.current = false;
    }
  }

  const fileLabel =
    picked.kind === "ready"
      ? `${picked.file.name}(${formatFileSize(picked.file.size)}・${picked.count.toLocaleString("en-US")}行)`
      : picked.kind === "none"
        ? "ファイルはまだ選ばれていません"
        : `${picked.name}(${formatFileSize(picked.size)})`;

  return (
    <section class="backup__card" aria-labelledby="backup-import-h">
      <div class="backup__card-head">
        <h2 id="backup-import-h" class="backup__h2">
          バックアップを読み込む
        </h2>
        <p class="backup__desc">書き出したJSONLを選びます。すでにある記録は上書きせず、重複はスキップします。5MB・5,000行まで。</p>
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
          {sending ? "読み込み中…" : "読み込む"}
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
      {outcome.kind === "done" && <ImportResult rows={outcome.rows} />}
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
