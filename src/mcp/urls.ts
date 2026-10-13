// MCP の戻り値に付ける、画面(Web UI)のURL。origin は /mcp へのリクエストのURLから取ったもの(ドメインをコードに書かない)
// 画面は Cloudflare Access の内側なので、利用者が自分のブラウザで開く(AI は開けない)

export const transactionUrl = (origin: string, id: string): string => `${origin}/tx/${encodeURIComponent(id)}`;

type WithId = { id: string };

// 取引1件に url(明細ページ)を足す
export function withTransactionUrl<T extends WithId>(origin: string, t: T): T & { url: string } {
  return { ...t, url: transactionUrl(origin, t.id) };
}

// 結果の中の取引(registered / transaction / transactions)に url を足し、重複で登録しなかったものには existing_url を足す
export function withTransactionUrls<R extends { ok: boolean }>(origin: string, result: R): R {
  if (!result.ok) return result;
  const r = result as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  if (Array.isArray(r.registered)) out.registered = (r.registered as WithId[]).map((t) => withTransactionUrl(origin, t));
  if (Array.isArray(r.transactions)) out.transactions = (r.transactions as WithId[]).map((t) => withTransactionUrl(origin, t));
  if (r.transaction && typeof r.transaction === "object") out.transaction = withTransactionUrl(origin, r.transaction as WithId);
  if (Array.isArray(r.skipped_duplicates)) {
    out.skipped_duplicates = (r.skipped_duplicates as { existing_id?: string }[]).map((d) => (d.existing_id ? { ...d, existing_url: transactionUrl(origin, d.existing_id) } : d));
  }
  return out as unknown as R;
}
