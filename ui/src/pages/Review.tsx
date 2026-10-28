import { useEffect, useState } from "preact/hooks";
import type { TransactionView } from "../../../src/api/contract";
import { BrandMark } from "../components/BrandMark";
import { getTransactionList } from "../api";
import { formatDateJa, formatYen } from "../format";
import { Link } from "../router";
import { reviewCountText, reviewReason, reviewTitle } from "./reviewLogic";
import "./Review.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: TransactionView[]; count: number };

// 要確認の記録の一覧(/review)。ホームの「要確認の記録があります」から来る。押すと、その記録の明細ページで直せる
export function Review() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getTransactionList("status=needs_review&limit=500")
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setState({ kind: "ready", items: res.transactions, count: res.count });
        else setState({ kind: "error", message: res.errors[0]?.message ?? "読み込めませんでした。" });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : "読み込めませんでした。" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <section class="page review">
      <header class="review__header">
        <h1 class="page__title brandmark-line">
          <BrandMark size={24} />
          要確認の記録
        </h1>
        <p class="muted review__lead">店名やカテゴリが入っていない記録です。押すと、その記録を開いて直せます。</p>
      </header>
      {state.kind === "loading" && <p class="muted">読み込み中です…</p>}
      {state.kind === "error" && (
        <div class="card review__error" role="alert">
          <p class="error">{state.message}</p>
          <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)}>
            もう一度読み込む
          </button>
        </div>
      )}
      {state.kind === "ready" && (
        <>
          <p class="muted review__count">{reviewCountText(state.count)}</p>
          <ul class="review__list">
            {state.items.map((t) => (
              <li key={t.id}>
                <Link href={`/tx/${encodeURIComponent(t.id)}`} class="review__row">
                  <span class="review__main">
                    <strong class="review__title">{reviewTitle(t)}</strong>
                    <span class="review__sub">
                      {formatDateJa(t.date)}
                      {t.memo ? ` ・ ${t.memo}` : ""}
                    </span>
                    <span class="chip chip--warn review__chip">{reviewReason(t)}</span>
                  </span>
                  <span class="review__amount">{formatYen(t.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
