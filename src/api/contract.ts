// Web UI と API の契約(型だけ)。UI は、この型を型として import する(実行時のコードは含めない)。
// 注意: core や Workers の型に依存しない、自己完結の定義にする。API側は、この型に `satisfies` で合わせる。

export type EventColor = "red" | "orange" | "green" | "blue" | "purple";

// 税金の控除用フラグ(1つの取引に1つ。なしは null)。ラベルは ui/src/taxFlags.ts
export type TaxFlag = "medical" | "self_medication" | "donation";

// カテゴリのアイコン(キー。未設定は null)。一覧とラベルは src/core/category-icons.ts、UI は ui/src/categoryIcons.ts
export type CategoryIconKey =
  | "food" | "cafe" | "grocery" | "daily" | "transit" | "taxi" | "car" | "fuel" | "social" | "entertainment"
  | "movie" | "education" | "book" | "clothes" | "beauty" | "medical" | "insurance" | "phone" | "utility" | "home"
  | "tax" | "bigspend" | "travel" | "gift" | "kids" | "pet" | "sports" | "hobby" | "subscription" | "bank" | "other";

export interface FieldError {
  index?: number;
  field: string;
  message: string;
}

export type ApiError = { ok: false; errors: FieldError[] };
export type ApiResult<T> = ({ ok: true } & T) | ApiError;

// 明細(レシートの1行)。amount はマイナス(値引き)もある。0 は無い
// category / tax_flag は行自身の値(実効ではない)。null の行は、取引の category / tax_flag に従う
export interface ItemView {
  id: string;
  // 並び順(0 始まり)
  position: number;
  name: string;
  amount: number;
  category: string | null;
  tax_flag: TaxFlag | null;
  memo: string | null;
}

export interface TransactionView {
  id: string;
  date: string;
  // 支払総額(正)。明細がある取引は、明細の amount の合計と一致する
  amount: number;
  merchant: string | null;
  category: string | null;
  account: string | null;
  memo: string | null;
  source: string;
  // 店名が無い、または実効カテゴリの無い行が1つでもあれば needs_review
  status: string;
  tax_flag: TaxFlag | null;
  // レシートに印字された情報(すべて任意。無ければ null)
  // 決済時刻(日本時間 HH:MM。日付は date)
  paid_time: string | null;
  merchant_phone: string | null;
  merchant_address: string | null;
  // 適格請求書発行事業者の登録番号(T + 数字13桁)
  invoice_number: string | null;
  // 対応した店員の名前(担当・責任者・レジなど)
  clerk_name: string | null;
  // レシート番号・伝票番号
  receipt_no: string | null;
  // 明細(position の順)。明細なしは空配列
  items: ItemView[];
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

export interface LinkView {
  id: string;
  // 正規化済みのhttps URL(Xの投稿 / YouTubeの動画)。タイトルの取得や埋め込みはしない
  url: string;
  kind: "x" | "youtube";
  title: string | null;
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

// GET /api/transactions/:id
export interface TransactionDetailData {
  transaction: TransactionView;
  // この取引に紐づく写真・リンク(transaction_id が一致するもの)
  photos: PhotoView[];
  links: LinkView[];
  counts: { items: number; photos: number; links: number };
}

// GET /api/day/:date(transactions の各取引に items が入る)
export interface DayData {
  date: string;
  total: number;
  count: number;
  transactions: TransactionView[];
  // その日と重なる出来事
  events: EventView[];
  // その日の写真(日付、その日の取引、その日と重なる出来事に紐づくもの)
  photos: PhotoView[];
  // その日のリンク(日付、その日の取引、その日と重なる出来事に紐づくもの)
  links: LinkView[];
}

// GET /api/categories
// categories は大分類ごと・追加順(group_name が大分類、name がサブカテゴリ)。usage はそのカテゴリを使っている取引の件数
export interface CategoryView {
  name: string;
  group_name: string;
  icon: CategoryIconKey | null;
  usage: number;
}

export interface CategoriesData {
  categories: CategoryView[];
  accounts: string[];
}

// POST /api/categories の入力。戻りは category と created_group(新しい大分類を作ったか)と message
export interface NewCategory {
  name: string;
  group_name: string;
  icon?: CategoryIconKey | null;
}

// PATCH /api/categories/:name の入力(パスの name が対象。1つ以上が必要)。戻りは category, created_group, message
export interface CategoryPatch {
  new_name?: string;
  group_name?: string;
  // null で外す
  icon?: CategoryIconKey | null;
}

// POST /api/category-groups/rename の入力。戻りは group, previous, updated(カテゴリの件数), merged(既存の大分類への統合か), message
export interface GroupRename {
  group: string;
  new_name: string;
}

// DELETE /api/categories/:name?move_to= の戻り(使用中は move_to が必要)
export interface CategoryDeleted {
  deleted: { name: string; group_name: string };
  moved: number;
  move_to: string | null;
  message: string;
}

// 明細の入力(add_transactions / update_transaction の items の1行)
export interface NewItem {
  // 品名(100文字まで)
  name: string;
  // 円・整数。値引きはマイナス。0 は不可。絶対値は 10,000,000 以下
  amount: number;
  // 省略または null で取引のカテゴリに従う
  category?: string | null;
  // 省略または null で取引のフラグに従う
  tax_flag?: TaxFlag | null;
  memo?: string | null;
}

// POST /api/transactions の入力(add_transactions と同じ規則)
// 戻りの registered の各取引は TransactionView に、同じ店の直近のカテゴリを使ったときだけ applied_default_category(カテゴリ名)が付く
export interface NewTransaction {
  date?: string;
  amount: number;
  merchant?: string;
  category?: string;
  account?: string;
  memo?: string;
  source?: "receipt" | "manual" | "voice";
  // 省略または null でフラグなし
  tax_flag?: TaxFlag | null;
  // レシートに印字された情報(すべて任意。TransactionView と同じ規則。invoice_number は全角・小文字の t・ハイフンや空白入りでも受け付けて正規化する)
  paid_time?: string | null;
  merchant_phone?: string | null;
  merchant_address?: string | null;
  invoice_number?: string | null;
  clerk_name?: string | null;
  receipt_no?: string | null;
  // 明細(50行まで)。合計は amount と一致させる(合わなければ 400、field: "items" で差額が返る)
  items?: NewItem[];
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
  // null でフラグを外す
  tax_flag?: TaxFlag | null;
  // レシートに印字された情報。省略は変更なし、null で空にする
  paid_time?: string | null;
  merchant_phone?: string | null;
  merchant_address?: string | null;
  invoice_number?: string | null;
  clerk_name?: string | null;
  receipt_no?: string | null;
  // 明細の全置換。省略または null で変えない、[] で明細を全部消す。明細があるときは合計 = amount(金額だけ変えるときも)
  items?: NewItem[] | null;
}

// DELETE /api/transactions/:id(?delete_photos=1 で写真もいっしょに消す。無ければ写真つきの取引は 400)
export interface TransactionDeleted {
  deleted: {
    // 削除前の内容
    transaction: TransactionView;
    // いっしょに消した件数
    items: number;
    photos: number;
    links: number;
  };
  message: string;
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

// POST /api/links の入力(date・transaction_id・event_id のうち1つ以上が必要)。
// 戻りは link と duplicate(同じ紐づけ先に同じ正規化URLがあれば true で、登録せず既存のものを返す)
export interface NewLink {
  url: string;
  title?: string;
  date?: string;
  transaction_id?: string;
  event_id?: string;
}

// PATCH /api/links/:id の入力(表題だけ変えられる。null で消去)
export interface LinkPatch {
  title: string | null;
}
