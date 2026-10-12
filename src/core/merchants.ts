import { z } from "zod";
import { phoneDigits } from "./receipt-details";
import { toFieldErrors, type FieldError } from "./schema";

// 店名の候補(インクリメンタルサーチ用)。過去の取引から、店名ごとにまとめて返す。MCP のツールにはしない(AI は list_transactions の keyword で足りる)。
// 店名は表記ゆれ(全角半角・大文字小文字・空白・ひらがなカタカナ)を吸収して同じ店にまとめる。
// 絞り込みは JS 側で行う(SQL の LIKE では全角半角やかなの違いを吸収できないため)ので、% と _ などの記号も文字としてそのまま比べる。

export const DEFAULT_MERCHANT_LIMIT = 8;
export const MAX_MERCHANT_LIMIT = 20;
const MAX_QUERY = 100;

export const merchantsQuerySchema = z.strictObject({
  q: z.string().trim().max(MAX_QUERY, `q は${MAX_QUERY}文字以内にしてください`).optional().describe("絞り込みの文字。店名・電話番号(数字だけでも可)・住所・カテゴリ名の部分一致。空なら、よく使う順"),
  category: z.string().trim().min(1, "category は1文字以上で指定してください").max(MAX_QUERY).optional().describe("カテゴリ名。その店のいちばん多く使ったカテゴリがこれの店だけに絞る"),
  limit: z
    .number({ error: `limit は1〜${MAX_MERCHANT_LIMIT}の整数で指定してください` })
    .int(`limit は1〜${MAX_MERCHANT_LIMIT}の整数で指定してください`)
    .min(1, `limit は1〜${MAX_MERCHANT_LIMIT}の整数で指定してください`)
    .max(MAX_MERCHANT_LIMIT, `limit は${MAX_MERCHANT_LIMIT}以下にしてください`)
    .default(DEFAULT_MERCHANT_LIMIT)
    .describe(`最大件数(既定${DEFAULT_MERCHANT_LIMIT}、最大${MAX_MERCHANT_LIMIT})`),
});

export interface MerchantView {
  // 店名(いちばん新しい取引の表記)
  merchant: string;
  // この店の取引の件数
  count: number;
  // 最後に使った日(YYYY-MM-DD)
  last_date: string;
  // いちばん多く使ったカテゴリ名・口座名(同数なら新しいほう。なしは null)
  category: string | null;
  account: string | null;
  // 電話番号・住所・事業者登録番号(項目ごとに、値のある最新の取引から。なしは null)
  phone: string | null;
  address: string | null;
  invoice_number: string | null;
}

export type ListMerchantsResult = { ok: true; merchants: MerchantView[] } | { ok: false; errors: FieldError[] };

// 比較用の形: 全角半角(NFKC)・大文字小文字・空白・カタカナ/ひらがなの違いを吸収する
export function foldText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 電話番号らしい入力(数字・ハイフン・括弧・プラス・空白だけで、数字を含む)なら、数字だけにして返す。そうでなければ ""
export function phoneQueryDigits(q: string): string {
  const n = q.normalize("NFKC");
  return /^[\d\-()+\s]+$/.test(n) ? phoneDigits(n) : "";
}

interface GroupRow {
  merchant: string;
  category: string | null;
  account: string | null;
  n: number;
  last_key: string;
}

interface DetailRow {
  merchant: string;
  phone: string | null;
  address: string | null;
  invoice_number: string | null;
}

interface Acc {
  key: string;
  count: number;
  lastKey: string;
  name: string;
  categories: Map<string, { n: number; last: string }>;
  accounts: Map<string, { n: number; last: string }>;
  phone: string | null;
  address: string | null;
  invoice_number: string | null;
}

function bump(map: Map<string, { n: number; last: string }>, name: string | null, n: number, last: string): void {
  if (name === null) return;
  const cur = map.get(name);
  if (!cur) map.set(name, { n, last });
  else {
    cur.n += n;
    if (last > cur.last) cur.last = last;
  }
}

// 件数の多い順、同数なら新しい順
function top(map: Map<string, { n: number; last: string }>): string | null {
  let best: [string, { n: number; last: string }] | null = null;
  for (const e of map) if (!best || e[1].n > best[1].n || (e[1].n === best[1].n && e[1].last > best[1].last)) best = e;
  return best ? best[0] : null;
}

const filled = (v: string | null | undefined): v is string => v != null && v.trim() !== "";

export async function listMerchants(db: D1Database, input: unknown): Promise<ListMerchantsResult> {
  const parsed = merchantsQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { q, category, limit } = parsed.data;

  // 店名 × カテゴリ × 口座ごとの件数。last_key は「日付|登録日時|id」(新しさの比較用)
  const groups = (
    await db
      .prepare(
        `SELECT t.merchant AS merchant, c.name AS category, a.name AS account, COUNT(*) AS n, MAX(t.date || '|' || t.created_at || '|' || t.id) AS last_key
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.merchant IS NOT NULL AND TRIM(t.merchant) <> ''
         GROUP BY t.merchant, t.category_id, t.account_id`,
      )
      .all<GroupRow>()
  ).results;

  const byKey = new Map<string, Acc>();
  for (const g of groups) {
    const key = foldText(g.merchant);
    if (key === "") continue;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { key, count: 0, lastKey: "", name: g.merchant, categories: new Map(), accounts: new Map(), phone: null, address: null, invoice_number: null };
      byKey.set(key, acc);
    }
    acc.count += g.n;
    if (g.last_key > acc.lastKey) {
      acc.lastKey = g.last_key;
      acc.name = g.merchant;
    }
    bump(acc.categories, g.category, g.n, g.last_key);
    bump(acc.accounts, g.account, g.n, g.last_key);
  }

  // 電話・住所・登録番号は、項目ごとに値のある最新の取引から(新しい順に読んで、最初に見つかった値を使う)
  const details = (
    await db
      .prepare(
        `SELECT merchant, merchant_phone AS phone, merchant_address AS address, invoice_number
         FROM transactions
         WHERE merchant IS NOT NULL AND TRIM(merchant) <> ''
           AND (merchant_phone IS NOT NULL OR merchant_address IS NOT NULL OR invoice_number IS NOT NULL)
         ORDER BY date DESC, created_at DESC, id DESC`,
      )
      .all<DetailRow>()
  ).results;
  for (const d of details) {
    const acc = byKey.get(foldText(d.merchant));
    if (!acc) continue;
    if (acc.phone === null && filled(d.phone)) acc.phone = d.phone;
    if (acc.address === null && filled(d.address)) acc.address = d.address;
    if (acc.invoice_number === null && filled(d.invoice_number)) acc.invoice_number = d.invoice_number;
  }

  const needle = foldText(q);
  const digits = q ? phoneQueryDigits(q) : "";
  const rows = [...byKey.values()].map((a) => ({
    a,
    view: {
      merchant: a.name,
      count: a.count,
      last_date: a.lastKey.slice(0, 10),
      category: top(a.categories),
      account: top(a.accounts),
      phone: a.phone,
      address: a.address,
      invoice_number: a.invoice_number,
    } satisfies MerchantView,
  }));

  const matched = rows.filter(({ a, view }) => {
    if (category !== undefined && view.category !== category) return false;
    if (needle === "") return true;
    if (a.key.includes(needle)) return true;
    if (digits !== "" && view.phone !== null && phoneDigits(view.phone).includes(digits)) return true;
    if (view.address !== null && foldText(view.address).includes(needle)) return true;
    return view.category !== null && foldText(view.category).includes(needle);
  });

  // 並び: (1) 店名が前方一致、(2) 件数の多い順、(3) 最後に使った日の新しい順、(4) 店名(安定させるため)
  matched.sort((x, y) => {
    if (needle !== "") {
      const px = x.a.key.startsWith(needle) ? 0 : 1;
      const py = y.a.key.startsWith(needle) ? 0 : 1;
      if (px !== py) return px - py;
    }
    if (x.view.count !== y.view.count) return y.view.count - x.view.count;
    if (x.view.last_date !== y.view.last_date) return x.view.last_date < y.view.last_date ? 1 : -1;
    return x.a.key < y.a.key ? -1 : x.a.key > y.a.key ? 1 : 0;
  });

  return { ok: true, merchants: matched.slice(0, limit).map((m) => m.view) };
}
