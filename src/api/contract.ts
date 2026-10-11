// Web UI と API の契約(型だけ)。UI は、この型を型として import する(実行時のコードは含めない)。
// 注意: core や Workers の型に依存しない、自己完結の定義にする。API側は、この型に `satisfies` で合わせる。

export type EventColor = "red" | "orange" | "green" | "blue" | "purple";

export interface FieldError {
  index?: number;
  field: string;
  message: string;
}

export type ApiError = { ok: false; errors: FieldError[] };
export type ApiResult<T> = ({ ok: true } & T) | ApiError;

export interface TransactionView {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
  category: string | null;
  account: string | null;
  memo: string | null;
  source: string;
  status: string;
}

export interface EventView {
  id: string;
  start_date: string;
  end_date: string | null;
  title: string;
  note: string | null;
  color: EventColor;
}

export interface PhotoView {
  id: string;
  // 認証つきでWorker経由で配信される。例: /api/photos/<id>
  url: string;
  caption: string | null;
  date: string | null;
  transaction_id: string | null;
  event_id: string | null;
  created_at: string;
}

export interface SummaryRow {
  key: string;
  label: string;
  count: number;
  total: number;
  percent: number;
}

// GET /api/home
export interface HomeData {
  today: { date: string; total: number; count: number };
  month: { month: string; from: string; to: string; total: number; count: number };
  // 大分類(group)別。金額の降順
  groups: SummaryRow[];
  // メモ(memo)がある取引の割合
  memo: { with_memo: number; total: number; percent: number };
  // status が needs_review の取引の件数
  needs_review: number;
  // 直近の取引(日付の新しい順、最大5件)
  recent: TransactionView[];
}

export interface CalendarDay {
  date: string;
  total: number;
  count: number;
  // その日に紐づく写真の枚数(日付、その日の取引、その日の出来事のいずれか)
  photos: number;
}

// GET /api/calendar?month=YYYY-MM (省略は今月・JST)
export interface CalendarData {
  month: string;
  total: number;
  // 取引のある日だけ(無い日は含めない)
  days: CalendarDay[];
  // その月と重なる出来事
  events: EventView[];
}

// GET /api/day/:date
export interface DayData {
  date: string;
  total: number;
  count: number;
  transactions: TransactionView[];
  // その日と重なる出来事
  events: EventView[];
  // その日の写真(日付、その日の取引、その日と重なる出来事に紐づくもの)
  photos: PhotoView[];
}

// GET /api/categories
export interface CategoriesData {
  categories: { name: string; group_name: string }[];
  accounts: string[];
}

// POST /api/transactions の入力(add_transactions と同じ規則)
export interface NewTransaction {
  date?: string;
  amount: number;
  merchant?: string;
  category?: string;
  account?: string;
  memo?: string;
  source?: "receipt" | "manual" | "voice";
  allow_duplicate?: boolean;
}

// PATCH /api/transactions/:id の入力(null で空にできる項目)
export interface TransactionPatch {
  date?: string;
  amount?: number;
  merchant?: string | null;
  category?: string | null;
  account?: string | null;
  memo?: string | null;
  source?: "receipt" | "manual" | "voice";
}

// POST /api/events の入力
export interface NewEvent {
  title: string;
  start_date: string;
  end_date?: string;
  note?: string;
  color?: EventColor;
}

// PATCH /api/events/:id の入力(null で期間解除・メモ消去)
export interface EventPatch {
  title?: string;
  start_date?: string;
  end_date?: string | null;
  note?: string | null;
  color?: EventColor;
}

// POST /api/photos (multipart/form-data) のフィールド
export interface PhotoMeta {
  date?: string;
  transaction_id?: string;
  event_id?: string;
  caption?: string;
}
