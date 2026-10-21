import { useEffect, useState } from "preact/hooks";
import { bookHeading, coverColor, statusLabel, type BookStatus } from "../pages/booksLogic";

// 本のカバー。カバー画像のURLがあれば出し、無い・読めないときは、タイトルを載せた色つきの表紙にする
// 外のサイトの画像なので、参照元(Referer)は送らない
export function BookCover(props: { title: string | null; isbn: string | null; coverUrl: string | null; class?: string; status?: BookStatus }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [props.coverUrl]);
  const heading = bookHeading({ title: props.title, isbn: props.isbn });
  const gone = props.status !== undefined && props.status !== "owned";
  const badge = gone ? <span class="bookcover__badge">{statusLabel(props.status!)}</span> : null;
  if (props.coverUrl && !failed) {
    return (
      <span class={`bookcover-wrap${gone ? " is-gone" : ""}`}>
        <img class={`bookcover ${props.class ?? ""}`} src={props.coverUrl} alt={`${heading}のカバー`} loading="lazy" referrerpolicy="no-referrer" onError={() => setFailed(true)} />
        {badge}
      </span>
    );
  }
  const c = coverColor(props.title ?? props.isbn ?? "");
  return (
    <span class={`bookcover-wrap${gone ? " is-gone" : ""}`}>
      <span class={`bookcover bookcover--blank ${props.class ?? ""}`} style={{ background: c.bg, color: c.fg }} role="img" aria-label={`${heading}(カバー画像なし)`}>
        <span>{heading}</span>
      </span>
      {badge}
    </span>
  );
}
