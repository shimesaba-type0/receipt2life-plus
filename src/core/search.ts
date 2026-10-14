import { z } from "zod";
import { isoDate, toFieldErrors, type FieldError } from "./schema";
import { phoneDigits } from "./receipt-details";

// 記録の横断検索。「映画に行った日」「皮膚科に最後に行ったのはいつ」のような問いのため、
// 取引(店名・メモ・カテゴリ・明細)、出来事、座席の記録、リンク、写真のキャプションを、キーワードで探して日付の新しい順に返す。読み取り専用。
// 空白で区切った語は、すべて(AND)含むものに絞る。1件の記録の中に、語ごとにどの項目でも当たればよい。
// 表記ゆれ(全角半角・大文字小文字・ひらがなカタカナ)は、SQL の LIKE では吸収できないので、候補の行を取ってから JS 側で正規化して比べる
// (個人の記録の規模なので、期間で絞った行をすべて読む)。ページ送りは offset / limit。

export const SEARCH_TYPES = ["transaction", "event", "seat_record", "link", "photo"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const DEFAULT_SEARCH_LIMIT = 30;
export const MAX_SEARCH_LIMIT = 100;
const MAX_TERMS = 5;
const MAX_QUERY = 200;

export const searchSchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(MAX_QUERY, `q は${MAX_QUERY}文字以内にしてください`)
    .default("")
    .describe(`探す言葉。空白で区切ると、すべてを含むものに絞る(最大${MAX_TERMS}語)。店名・メモ・カテゴリ名・明細の名前・出来事のタイトル・映画の題名・会場名・リンクのタイトルや説明・写真のキャプションに部分一致。省略か空なら絞り込まず、types と期間(from / to)に当たる記録を新しい順にすべて返す(例: types に seat_record だけを指定して、映画を見た日の一覧)`),
  from: isoDate.optional().describe("この日以降(YYYY-MM-DD)"),
  to: isoDate.optional().describe("この日まで(YYYY-MM-DD)"),
  types: z.array(z.enum(SEARCH_TYPES)).min(1).optional().describe("探す対象。省略すると全部(transaction=取引、event=出来事、seat_record=座席の記録、link=リンク、photo=写真)"),
  limit: z
    .number({ error: `limit は1〜${MAX_SEARCH_LIMIT}の整数で指定してください` })
    .int()
    .min(1, `limit は1〜${MAX_SEARCH_LIMIT}の整数で指定してください`)
    .max(MAX_SEARCH_LIMIT, `limit は${MAX_SEARCH_LIMIT}以下にしてください`)
    .default(DEFAULT_SEARCH_LIMIT)
    .describe(`1回に返す最大件数(既定${DEFAULT_SEARCH_LIMIT}、最大${MAX_SEARCH_LIMIT})。新しい日付から`),
  offset: z
    .number({ error: "offset は0以上の整数で指定してください" })
    .int("offset は0以上の整数で指定してください")
    .min(0, "offset は0以上の整数で指定してください")
    .max(100_000, "offset が大きすぎます")
    .default(0)
    .describe("読み飛ばす件数(既定0)。次のページは offset に前の offset + count を渡す。has_more が true の間は続きがある"),
});

export interface SearchHit {
  type: SearchType;
  id: string;
  // 日の画面で開く日付(出来事は開始日、リンク・写真は紐づく日)
  date: string;
  // 見出し(店名、出来事のタイトル、映画の題名など)
  title: string;
  // 補足(カテゴリ、メモ、期間など。なければ null)
  detail: string | null;
  // 取引のときだけ金額
  amount: number | null;
  // 取引の id(取引・座席の記録・取引に付いたリンク/写真のとき)
  transaction_id: string | null;
}

export type SearchResult =
  | {
      ok: true;
      query: string;
      // 条件に合う全件数(返すのは limit まで)
      total: number;
      // 条件に合う中でいちばん新しい日(なければ null)
      latest_date: string | null;
      count: number;
      // 読み飛ばした件数(リクエストの offset)
      offset: number;
      // offset + count より後ろにも、条件に合う記録があるか
      has_more: boolean;
      hits: SearchHit[];
      message: string;
    }
  | { ok: false; errors: FieldError[] };

// 表記ゆれをそろえる: 全角半角(NFKC)、英字の大文字小文字、カタカナ→ひらがな
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const join = (...columns: string[]) => columns.map((c) => `COALESCE(${c}, '')`).join(" || ' ' || ");

interface Source {
  type: SearchType;
  // 日付の式(from / to の絞り込みと並び順に使う)
  date: string;
  from: string;
  // 検索の対象にする文字(SQL の式)
  hay: string;
  // 取り出す列。id, date, title, detail, amount, transaction_id の別名で返す。phone は電話番号(数字だけでも当てるため)
  select: string;
  order: string;
}

const LINK_DATE = "COALESCE(l.date, lt.date, le.start_date)";
const PHOTO_DATE = "COALESCE(a.date, pt.date, pe.start_date)";

const SOURCES: Source[] = [
  {
    type: "transaction",
    date: "t.date",
    from: "FROM transactions t LEFT JOIN categories c ON c.id = t.category_id",
    hay: `${join("t.merchant", "t.merchant_phone", "t.merchant_address", "t.clerk_name", "t.memo", "t.receipt_no", "t.invoice_number", "c.name")} || ' ' || COALESCE((SELECT group_concat(COALESCE(i.name, '') || ' ' || COALESCE(i.memo, '') || ' ' || COALESCE(i.product, '') || ' ' || COALESCE(i.jan_code, ''), ' ') FROM transaction_items i WHERE i.transaction_id = t.id), '')`,
    select:
      "t.id AS id, t.date AS date, COALESCE(t.merchant, '(店名なし)') AS title, COALESCE(c.name, '') || CASE WHEN t.memo IS NOT NULL AND t.memo != '' THEN ' ' || t.memo ELSE '' END AS detail, t.amount AS amount, t.id AS transaction_id, t.merchant_phone AS phone",
    order: "t.date DESC, t.created_at DESC, t.id",
  },
  {
    type: "event",
    date: "e.start_date",
    from: "FROM events e",
    hay: join("e.title", "e.note"),
    select:
      "e.id AS id, e.start_date AS date, e.title AS title, CASE WHEN e.end_date IS NOT NULL THEN e.start_date || '〜' || e.end_date ELSE '' END || CASE WHEN e.note IS NOT NULL AND e.note != '' THEN ' ' || e.note ELSE '' END AS detail, NULL AS amount, NULL AS transaction_id, NULL AS phone",
    order: "e.start_date DESC, e.created_at DESC, e.id",
  },
  {
    type: "seat_record",
    date: "r.date",
    from: "FROM seat_records r JOIN venues v ON v.id = r.venue_id LEFT JOIN screens s ON s.id = r.screen_id",
    hay: join("r.title", "r.note", "v.name", "s.name"),
    select:
      "r.id AS id, r.date AS date, COALESCE(r.title, v.name) AS title, v.name || COALESCE(' ' || s.name, '') || ' ' || r.seat AS detail, NULL AS amount, r.transaction_id AS transaction_id, NULL AS phone",
    order: "r.date DESC, r.created_at DESC, r.id",
  },
  {
    type: "link",
    date: LINK_DATE,
    from: "FROM links l LEFT JOIN transactions lt ON lt.id = l.transaction_id LEFT JOIN events le ON le.id = l.event_id",
    hay: join("l.title", "l.description", "l.url"),
    select: `l.id AS id, ${LINK_DATE} AS date, COALESCE(l.title, l.url) AS title, l.description AS detail, NULL AS amount, l.transaction_id AS transaction_id, NULL AS phone`,
    order: `${LINK_DATE} DESC, l.created_at DESC, l.id`,
  },
  {
    type: "photo",
    date: PHOTO_DATE,
    from: "FROM attachments a LEFT JOIN transactions pt ON pt.id = a.transaction_id LEFT JOIN events pe ON pe.id = a.event_id",
    hay: join("a.caption"),
    select: `a.id AS id, ${PHOTO_DATE} AS date, COALESCE(a.caption, '写真') AS title, NULL AS detail, NULL AS amount, a.transaction_id AS transaction_id, NULL AS phone`,
    order: `${PHOTO_DATE} DESC, a.created_at DESC, a.id`,
  },
];

type Row = SearchHit & { hay: string; phone: string | null };

export async function searchRecords(db: D1Database, input: unknown): Promise<SearchResult> {
  const parsed = searchSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const { q, from, to, types, limit, offset } = parsed.data;
  if (from && to && from > to) return { ok: false, errors: [{ field: "from", message: "from: from は to 以前の日付にしてください" }] };
  const terms = normalizeForSearch(q).split(/\s+/).filter(Boolean);
  if (terms.length > MAX_TERMS) return { ok: false, errors: [{ field: "q", message: `q: 語は${MAX_TERMS}つまでにしてください` }] };
  // 電話番号らしい語(数字・ハイフン・括弧・プラス・空白だけ)は、数字だけにそろえた比較でも当てる
  const digitTerms = terms.map((t) => (/^[\d\-()+]+$/.test(t) ? phoneDigits(t) : ""));

  const label = q === "" ? "条件" : `「${q}」`;
  const wanted = SOURCES.filter((s) => !types || types.includes(s.type));
  const perSource = await Promise.all(
    wanted.map(async (s) => {
      const where = [`${s.date} IS NOT NULL`];
      const params: string[] = [];
      if (from) {
        where.push(`${s.date} >= ?`);
        params.push(from);
      }
      if (to) {
        where.push(`${s.date} <= ?`);
        params.push(to);
      }
      const { results } = await db
        .prepare(`SELECT '${s.type}' AS type, ${s.select}, ${s.hay} AS hay ${s.from} WHERE ${where.join(" AND ")} ORDER BY ${s.order}`)
        .bind(...params)
        .all<Row>();
      return results.filter((row) => {
        const hay = normalizeForSearch(row.hay);
        const digits = row.phone ? phoneDigits(row.phone) : "";
        return terms.every((t, i) => hay.includes(t) || (digitTerms[i] !== "" && digits.includes(digitTerms[i]!)));
      });
    }),
  );

  // 新しい日付の順(同じ日は、種類ごとの並びのまま)
  const all = perSource.flat().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const total = all.length;
  const hits: SearchHit[] = all.slice(offset, offset + limit).map((r) => ({ type: r.type, id: r.id, date: r.date, title: r.title, detail: r.detail && r.detail.trim() !== "" ? r.detail.trim() : null, amount: r.amount, transaction_id: r.transaction_id }));
  return {
    ok: true,
    query: q,
    total,
    latest_date: all[0]?.date ?? null,
    count: hits.length,
    offset,
    has_more: offset + hits.length < total,
    hits,
    message:
      total === 0
        ? `${label}に当てはまる記録はありません`
        : `${label}に当てはまる記録が${total}件あります。いちばん新しいのは${all[0]!.date}です${total > hits.length ? `(${offset + 1}〜${offset + hits.length}件目を新しい順に返しました${offset + hits.length < total ? "。続きは offset を進めて取得できます" : ""})` : ""}`,
  };
}
