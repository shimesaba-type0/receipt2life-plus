import { useEffect, useState } from "preact/hooks";
import { bookHeading, coverColor } from "../pages/booksLogic";

// 本のカバー。カバー画像のURLがあれば出し、無い・読めないときは、タイトルを載せた色つきの表紙にする
// 外のサイトの画像なので、参照元(Referer)は送らない
export function BookCover(props: { title: string | null; isbn: string | null; coverUrl: string | null; class?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [props.coverUrl]);
  const heading = bookHeading({ title: props.title, isbn: props.isbn });
  if (props.coverUrl && !failed) {
    return <img class={`bookcover ${props.class ?? ""}`} src={props.coverUrl} alt={`${heading}のカバー`} loading="lazy" referrerpolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  const c = coverColor(props.title ?? props.isbn ?? "");
  return (
    <div class={`bookcover bookcover--blank ${props.class ?? ""}`} style={{ background: c.bg, color: c.fg }} role="img" aria-label={`${heading}(カバー画像なし)`}>
      <span>{heading}</span>
    </div>
  );
}
