import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { PhotoMeta } from "../../../src/api/contract";
import { uploadPhoto } from "../api";
import { UPLOAD_CONCURRENCY, type UploadStatus, planUploads, runWithLimit, statusLabel, summarizeResults } from "../photo-queue";
import { resizePhoto } from "../photo-resize-browser";
import "../pages/Day.css";

interface UploadItem {
  id: number;
  name: string;
  status: UploadStatus;
  error: string | null;
}

export interface UploadBatchResult {
  ok: number;
  failed: number;
}

export interface PhotoUploaderProps {
  // 写真に付ける紐づけ先(date / transaction_id / event_id / caption)
  meta: PhotoMeta;
  disabled?: boolean;
  // 見出し(省略すると出さない)
  title?: string;
  // 見出しの右に出す副題
  subtitle?: string;
  addLabel?: string;
  hint?: string;
  // 「写真を追加」ボタンの隣に並べる操作(Day の「選択」など)
  tools?: ComponentChildren;
  // 進行状況の欄に足す表示(Day の削除結果など)
  status?: ComponentChildren;
  // 枠の中、進行状況の下に出す内容(写真の一覧など)。関数なら、ファイル選択を開く関数と操作不可かどうかを受け取る
  children?: ComponentChildren | ((openPicker: () => void, off: boolean) => ComponentChildren);
  // 1回のアップロードを始めたとき
  onStart?: () => void;
  // 1回のアップロードが終わったとき(成功・失敗の枚数)
  onDone?: (result: UploadBatchResult) => void | Promise<void>;
  // アップロード中かどうかが変わったとき
  onBusyChange?: (busy: boolean) => void;
  // 値が変わると、状態一覧と結果の表示を消す
  clearSignal?: number;
}

const DEFAULT_HINT = "複数まとめて追加できます(1回20枚まで)。パソコンでは、この枠に画像をドラッグ&ドロップしても追加できます。";

// 写真の複数アップロード(複数選択、ドラッグ&ドロップ、同時2件、状態一覧、結果表示)
export function PhotoUploader(props: PhotoUploaderProps) {
  const { meta, disabled = false } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const workingRef = useRef(false);
  const [working, setWorking] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const off = disabled || working;

  useEffect(() => {
    if (props.clearSignal === undefined || workingRef.current) return;
    setUploads([]);
    setResultMsg(null);
  }, [props.clearSignal]);

  async function upload(files: File[]) {
    if (files.length === 0 || disabled || workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    props.onBusyChange?.(true);
    setResultMsg(null);
    props.onStart?.();
    const plan = planUploads(files);
    const accepted = new Set<File>(plan.accepted);
    let r = 0;
    const items: UploadItem[] = files.map((f, id) => {
      if (accepted.has(f)) return { id, name: f.name, status: "waiting", error: null };
      return { id, name: f.name, status: "failed", error: plan.rejected[r++]?.reason ?? "追加できません。" };
    });
    setUploads(items);
    const patch = (id: number, p: Partial<UploadItem>) => setUploads((cur) => cur.map((u) => (u.id === id ? { ...u, ...p } : u)));
    const final = new Map<number, string | null>();
    try {
      const targets = items.filter((it) => it.status === "waiting");
      await runWithLimit(targets, UPLOAD_CONCURRENCY, async (it) => {
        const file = files[it.id] as File;
        let error: string | null = null;
        try {
          patch(it.id, { status: "resizing" });
          const blob = await resizePhoto(file);
          patch(it.id, { status: "uploading" });
          const res = await uploadPhoto(blob, meta);
          if (!res.ok) error = res.errors.map((e) => e.message).join(" / ") || "うまくいきませんでした。";
        } catch (err) {
          error = err instanceof Error ? err.message : "画像を処理できませんでした。";
        }
        patch(it.id, error ? { status: "failed", error } : { status: "done" });
        final.set(it.id, error);
      });
      const summary = summarizeResults(
        "追加",
        items.map((it) => ({ name: it.name, error: it.status === "failed" ? it.error : (final.get(it.id) ?? null) })),
      );
      setResultMsg(summary.message);
      await props.onDone?.({ ok: summary.ok, failed: summary.failed });
    } finally {
      workingRef.current = false;
      setWorking(false);
      props.onBusyChange?.(false);
    }
  }

  function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    void upload(files);
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return (
    <div
      class={`card day__drop${dragOver ? " is-over" : ""}`}
      onDragEnter={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragOver(false);
        void upload(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      <div class={`day__row-head${props.subtitle ? " day__row-head--sub" : ""}`}>
        {props.title ? <h2 class="day__h">{props.title}</h2> : <span />}
        {props.subtitle && <span class="muted day__sub">{props.subtitle}</span>}
        <div class="day__photo-tools">
          {props.tools}
          <button type="button" class="btn" disabled={off} onClick={() => fileRef.current?.click()}>
            {props.addLabel ?? "写真を追加"}
          </button>
          <input ref={fileRef} type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" multiple tabIndex={-1} onChange={onPick} aria-label="写真のファイル" />
        </div>
      </div>
      <p class="muted day__hint">{props.hint ?? DEFAULT_HINT}</p>

      <div class="day__progress" role="status">
        {uploads.length > 0 && (
          <ul class="day__queue">
            {uploads.map((u) => (
              <li key={u.id} class={`day__queue-item is-${u.status}`}>
                <span class="day__queue-name">{u.name}</span>
                <span class="day__queue-state">{statusLabel(u.status)}</span>
                {u.status === "failed" && u.error && <span class="day__queue-error">{u.error}</span>}
              </li>
            ))}
          </ul>
        )}
        {resultMsg && <p class="day__result">{resultMsg}</p>}
        {props.status}
      </div>
      {typeof props.children === "function" ? props.children(() => fileRef.current?.click(), off) : props.children}
    </div>
  );
}
