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

// 座席の記録(映画館のスクリーン・座席など。venue=会場、screen=スクリーン/ホール/エリア、seat=座席、seat_class=席種)
export interface SeatRecordView {
  id: string;
  date: string;
  // 作品名・公演名(映画のタイトル、ライブ名など。100文字まで)。なければ null
  title: string | null;
  // 会場名・スクリーン名(名前)と、その id(会場・スクリーンは別のレコード)
  venue: string;
  venue_id: string;
  screen: string | null;
  screen_id: string | null;
  // そのスクリーンの特徴(screens.note)。スクリーンがない・noteがなければ null
  screen_note: string | null;
  seat: string;
  // 席種(プレミアムシート、内野指定席など。50文字まで)。なければ null
  seat_class: string | null;
  // 席の評価(整数1〜5、5が最良)。未評価は null
  rating: number | null;
  // 一言(200文字まで)
  note: string | null;
  // 紐づけた取引(取引が消えたら null になる)
  transaction_id: string | null;
  created_at: string;
}

// 会場・スクリーン・座席ごとの集計。avg_rating は評価のある記録の平均(小数1桁。評価がなければ null)
export interface SeatSummaryRow {
  venue: string;
  screen: string | null;
  seat: string;
  count: number;
  rated_count: number;
  avg_rating: number | null;
}

// 会場とその下のスクリーン(席選びの参考用の件数・平均評価つき。avg_rating は小数1桁、評価がなければ null)
export interface ScreenSummary {
  id: string;
  name: string;
  // そのスクリーンの特徴(例: 前方は首が疲れる)
  note: string | null;
  record_count: number;
  rated_count: number;
  avg_rating: number | null;
}

export interface VenueSummary {
  id: string;
  name: string;
  record_count: number;
  rated_count: number;
  avg_rating: number | null;
  screens: ScreenSummary[];
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
  // その日の座席の記録(date が一致するもの。登録順)
  seat_records: SeatRecordView[];
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

// GET /api/accounts(口座の管理画面用。GET /api/categories の accounts は名前だけの string[] のまま)
// accounts は追加順。usage はその口座を使っている取引の件数
export interface AccountView {
  name: string;
  usage: number;
}

export interface AccountsData {
  accounts: AccountView[];
}

// POST /api/accounts の入力。戻りは account と message
export interface NewAccount {
  name: string;
}

// PATCH /api/accounts/:name の入力(パスの name が対象)。戻りは account と message
export interface AccountPatch {
  new_name: string;
}

// DELETE /api/accounts/:name?move_to= の戻り(使用中は move_to が必要)
export interface AccountDeleted {
  deleted: { name: string };
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

// GET /api/seat-records?date=&title=(部分一致)&venue=&screen=&seat=&seat_class=(部分一致)&min_rating=&max_rating=&from=&to=&transaction_id=&limit=
// date はその日だけ(from と to を同じ日にする)。並びは date の新しい順。
// count は絞り込みに合う全件の数、records は limit まで、summary は venue・screen・seat ごとの件数と平均評価(全件で集計)
export interface SeatRecordsData {
  count: number;
  records: SeatRecordView[];
  summary: SeatSummaryRow[];
  truncated: boolean;
  message: string;
}

// POST /api/seat-records の入力。戻りは seat_record と message
export interface NewSeatRecord {
  date: string;
  // 作品名・公演名(任意。空文字は未指定)
  title?: string;
  venue: string;
  screen?: string;
  seat: string;
  // 席種(任意。空文字は未指定)
  seat_class?: string;
  // 1〜5 の整数(5が最良)
  rating?: number;
  note?: string;
  transaction_id?: string;
}

// PATCH /api/seat-records/:id の入力(指定した項目だけ変える。title / seat_class / screen / rating / note / transaction_id は null で消去)
export interface SeatRecordPatch {
  date?: string;
  // null か空文字で消去
  title?: string | null;
  venue?: string;
  screen?: string | null;
  seat?: string;
  // null か空文字で消去
  seat_class?: string | null;
  rating?: number | null;
  note?: string | null;
  transaction_id?: string | null;
}

// POST /api/seat-records と PATCH の戻り: created_venue / created_screen は、会場・スクリーンを新規に作ったか
export interface SeatRecordSaved {
  seat_record: SeatRecordView;
  created_venue: boolean;
  created_screen: boolean;
  message: string;
}

// GET /api/venues: 会場ごとにスクリーンと、記録の件数・平均評価。フォームの候補にも使う
export interface VenuesData {
  count: number;
  venues: VenueSummary[];
  message: string;
}

// PATCH /api/venues/:id の入力(会場名の変更。戻りは venue と message)
export interface VenuePatch {
  name: string;
}

// PATCH /api/screens/:id の入力(指定した項目だけ変える。note は null か空文字で消去。戻りは screen と message)
export interface ScreenPatch {
  name?: string;
  note?: string | null;
}
