import { useEffect, useRef, useState } from "preact/hooks";
import type { LinkView } from "../../../src/api/contract";
import { isSafeLinkHref, linkDisplayText, linkKindLabel, tweetIdOf } from "../pages/dayLogic";
import "./LinkCard.css";

// 種類ごとのアイコン。ブランドロゴの再現ではなく、モノトーンの簡略図形(装飾なので aria-hidden)
function KindIcon(props: { kind: LinkView["kind"] }) {
  if (props.kind === "youtube") {
    return (
      <svg class="link__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
        <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
        <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
      </svg>
    );
  }
  if (props.kind === "instagram") {
    return (
      <svg class="link__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <path d="M17.2 6.8h.01" />
      </svg>
    );
  }
  return (
    <svg class="link__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M5 4.5l14 15M19 4.5l-14 15" />
    </svg>
  );
}

// Xの公式の埋め込み(widgets.js)。押したときだけ外部のスクリプトを読み込む(最初から読み込まない=Xに無断で通信しない)。
// 投稿のID(数字)だけを渡し、外から受け取ったHTMLは画面に入れない。dnt=追跡しない
interface TwitterWidgets {
  widgets: { createTweet: (id: string, el: HTMLElement, options: Record<string, unknown>) => Promise<HTMLElement | undefined> };
}
let widgetsLoading: Promise<TwitterWidgets> | null = null;
function loadTwitterWidgets(): Promise<TwitterWidgets> {
  const w = window as unknown as { twttr?: TwitterWidgets };
  if (w.twttr?.widgets) return Promise.resolve(w.twttr);
  widgetsLoading ??= new Promise<TwitterWidgets>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.onload = () => (w.twttr?.widgets ? resolve(w.twttr) : reject(new Error("widgets")));
    script.onerror = () => reject(new Error("load"));
    document.head.appendChild(script);
  }).catch((e: unknown) => {
    widgetsLoading = null;
    throw e;
  });
  return widgetsLoading;
}

function TweetEmbed(props: { id: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let cancelled = false;
    const el = box.current;
    if (!el) return;
    loadTwitterWidgets()
      .then((twttr) => twttr.widgets.createTweet(props.id, el, { dnt: true, lang: "ja", conversation: "none", align: "center" }))
      .then((created) => {
        if (!cancelled) setState(created ? "ready" : "failed");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
      el.replaceChildren();
    };
  }, [props.id]);
  return (
    <div class="link__embed">
      <div ref={box} />
      {state === "loading" && <p class="muted link__embed-note" role="status">Xから読み込み中…</p>}
      {state === "failed" && (
        <p class="muted link__embed-note" role="status">
          表示できませんでした(投稿が削除・非公開、またはXに接続できません)。上のリンクから開いてください。
        </p>
      )}
    </div>
  );
}

// リンク1件のカード。埋め込み・画像・サムネイルは出さない(リンクを開くだけ)。タイトルは、登録のときにサーバーが取りに行く(無ければ「タイトルを取得」で付け直せる)
export function LinkCard(props: {
  link: LinkView;
  busy: boolean;
  onSaveTitle: (id: string, title: string | null) => Promise<boolean>;
  // タイトルが無いリンクのタイトルを、取りに行って付ける(省略するとボタンを出さない)
  onFetchTitle?: (id: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { link, busy } = props;
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [embedOpen, setEmbedOpen] = useState(false);
  const tweetId = link.kind === "x" ? tweetIdOf(link.url) : null;
  const [title, setTitle] = useState(link.title ?? "");
  const inputId = useRef(`lk-${Math.random().toString(36).slice(2, 8)}`).current;
  const text = linkDisplayText(link);
  const label = linkKindLabel(link.kind);

  return (
    <div class="link">
      {isSafeLinkHref(link.url) ? (
        <a class="link__open" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${label}のリンクを新しいタブで開く: ${text}`}>
          <KindIcon kind={link.kind} />
          <span class="link__text">
            <span class="link__title">{text}</span>
            <span class="link__kind muted">{label}</span>
          </span>
        </a>
      ) : (
        <div class="link__open">
          <KindIcon kind={link.kind} />
          <span class="link__text">
            <span class="link__title">{text}</span>
            <span class="link__kind muted">{label}</span>
          </span>
        </div>
      )}

      {mode === "view" && (
        <div class="link__actions">
          <button
            type="button"
            class="btn"
            disabled={busy}
            onClick={() => {
              setTitle(link.title ?? "");
              setMode("edit");
            }}
          >
            タイトルを編集
          </button>
          {tweetId && (
            <button type="button" class="btn" aria-expanded={embedOpen} onClick={() => setEmbedOpen((v) => !v)}>
              {embedOpen ? "投稿を閉じる" : "投稿を表示"}
            </button>
          )}
          {!link.title && link.kind !== "instagram" && props.onFetchTitle && (
            <button type="button" class="btn" disabled={busy} onClick={() => void props.onFetchTitle?.(link.id)}>
              タイトルを取得
            </button>
          )}
          <button type="button" class="btn day__danger" disabled={busy} onClick={() => setMode("confirm")}>
            削除
          </button>
        </div>
      )}

      {embedOpen && tweetId && <TweetEmbed id={tweetId} />}

      {mode === "edit" && (
        <form
          class="day__form link__form"
          onSubmit={(e) => {
            e.preventDefault();
            void props.onSaveTitle(link.id, title.trim() === "" ? null : title.trim()).then((ok) => {
              if (ok) setMode("view");
            });
          }}
        >
          <label for={inputId}>タイトル(空にすると消えます)</label>
          <input id={inputId} type="text" maxLength={200} value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
          <div class="day__actions">
            <button type="submit" class="btn btn--primary" disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => setMode("view")}>
              キャンセル
            </button>
          </div>
        </form>
      )}

      {mode === "confirm" && (
        <div class="day__confirm" role="alertdialog" aria-label="リンクの削除の確認">
          <p>このリンクを削除します。元に戻せません。よろしいですか?</p>
          <div class="day__actions">
            <button
              type="button"
              class="btn day__danger"
              disabled={busy}
              onClick={() =>
                void props.onDelete(link.id).then((ok) => {
                  if (!ok) setMode("view");
                })
              }
            >
              削除する
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => setMode("view")}>
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
