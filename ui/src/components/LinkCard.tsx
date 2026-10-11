import { useRef, useState } from "preact/hooks";
import type { LinkView } from "../../../src/api/contract";
import { isSafeLinkHref, linkDisplayText, linkKindLabel } from "../pages/dayLogic";
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
  return (
    <svg class="link__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M5 4.5l14 15M19 4.5l-14 15" />
    </svg>
  );
}

// リンク1件のカード。外部サイトの埋め込み・画像・サムネイル取得はしない(リンクを開くだけ)
export function LinkCard(props: {
  link: LinkView;
  busy: boolean;
  onSaveTitle: (id: string, title: string | null) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { link, busy } = props;
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
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
          <button type="button" class="btn day__danger" disabled={busy} onClick={() => setMode("confirm")}>
            削除
          </button>
        </div>
      )}

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
