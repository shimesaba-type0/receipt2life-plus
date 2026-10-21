// Web UI と API の契約(型だけ)。UI は、この型を型として import する(実行時のコードは含めない)。
// 注意: core や Workers の型に依存しない、自己完結の定義にする。API側は、この型に `satisfies` で合わせる。

export type EventColor = "red" | "orange" | "green" | "blue" | "purple";

// 税金の控除用フラグ(1つの取引に1つ。なしは null)。ラベルは ui/src/taxFlags.ts
export type TaxFlag = "medical" | "self_medication" | "donation";

// カテゴリのアイコン(キー。未設定は null)。一覧とラベルは src/core/category-icons.ts、UI は ui/src/categoryIcons.ts
export type CategoryIconKey =
  | "food" | "cafe" | "grocery" | "daily" | "transit" | "taxi" | "car" | "fuel" | "social" | "entertainment"
  | "movie" | "education" | "book" | "clothes" | "beauty" | "medical" | "insurance" | "phone" | "utility" | "home"
  | "tax" | "bigspend" | "travel" | "gift" | "kids" | "pet" | "sports" | "hobby" | "subscription" | "bank"
  | "manga" | "bicycle" | "express" | "shinkansen" | "airplane" | "hotel" | "other";

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
  // 消費税の税率(%。レシートの印字どおり。0〜100、小数可。不明は null)。tax_flag とは別物
  tax_rate: number | null;
  // 印字どおりの税率の記号(「※」「軽」など。20文字まで。なしは null)
  tax_label: string | null;
  // 商品の情報(任意。AI が補う)。product=統一した商品名、quantity=買った数、content_amount / content_unit=1つあたりの内容量
  product: string | null;
  quantity: number | null;
  content_amount: number | null;
  content_unit: ContentUnit | null;
  // JANコード(商品のバーコード。8桁か13桁の数字。分かるときだけ。なしは null)
  jan_code: string | null;
  // 単価(1g・1ml・1個あたりの円)。内容量が無い行・値引きの行は null。保存せず、計算して返す
  unit_price: UnitPrice | null;
}

// 内容量の単位。g=重さ、ml=容量、個=個数(枚・本・パックも個)
export type ContentUnit = "g" | "ml" | "個";
export interface UnitPrice {
  per_unit: number;
  unit: ContentUnit;
}

// 対象金額が税込(included)か税抜(excluded)か
export type AmountBasis = "included" | "excluded";

// 税の内訳(レシート下部の税率別の内訳)の1行。印字どおりの数字で、こちらで計算しない
export interface TaxLineView {
  id: string;
  // 税率(%)
  rate: number;
  // 対象金額(円)。印字が無ければ null
  taxable_amount: number | null;
  // 消費税額(円)。印字が無ければ null
  tax_amount: number | null;
  amount_basis: AmountBasis | null;
  // 印字の記号(20文字まで)
  label: string | null;
}

// 税の内訳の入力(税率ごとに1行。同じ税率は1つだけ。10行まで)
export interface NewTaxLine {
  rate: number;
  taxable_amount?: number | null;
  tax_amount?: number | null;
  amount_basis?: AmountBasis | null;
  label?: string | null;
}

// 税の内訳の合計が金額と合わないなどの注意(エラーにはしない)
export interface TaxWarning {
  index?: number;
  field: string;
  message: string;
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
  // レジ番号(例: 0005)・店番号/店舗コード(例: 007832)。receipt_no(伝票番号)とは別
  register_no: string | null;
  store_code: string | null;
  // 明細(position の順)。明細なしは空配列
  items: ItemView[];
  // 税の内訳(税率の高い順)。なしは空配列
  tax_lines: TaxLineView[];
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
  // 正規化済みのhttps URL(Xの投稿 / YouTubeの動画 / Instagramの投稿 / ウェブのページ)。タイトルは登録のときに取得する(YouTube・Xだけ)。それ以外は AI が付ける
  url: string;
  kind: "x" | "youtube" | "instagram" | "web";
  title: string | null;
  // 説明文(AI が読んだ要約など)
  description: string | null;
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
  // 今月(month と同じ範囲)の割引。レシートに印字された割引行(マイナスの明細)だけの合計(正の円)と行数
  discounts: { month_total: number; month_line_count: number };
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
  // その月の大分類(group)別の内訳。金額の降順(ホームの groups と同じ集計)
  groups: SummaryRow[];
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
  // 税率(%。0〜100、小数は第3位まで)。省略または null で不明
  tax_rate?: number | null;
  // 印字の記号(20文字まで)。空文字は値なし
  tax_label?: string | null;
  // 商品の情報(すべて任意)。content_amount と content_unit はセット(片方だけはエラー)
  product?: string | null;
  quantity?: number | null;
  content_amount?: number | null;
  content_unit?: ContentUnit | null;
  // JANコード(8桁か13桁の数字。末尾のチェックデジットが合わないものはエラー。ハイフン・空白・全角は取り除かれる)
  jan_code?: string | null;
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
  register_no?: string | null;
  store_code?: string | null;
  // 明細(50行まで)。合計は amount と一致させる(合わなければ 400、field: "items" で差額が返る)
  items?: NewItem[];
  // 税の内訳。合計が合わなくてもエラーにはせず、戻りの tax_warnings で知らせる
  tax_lines?: NewTaxLine[];
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
  register_no?: string | null;
  store_code?: string | null;
  // 明細の全置換。省略または null で変えない、[] で明細を全部消す。明細があるときは合計 = amount(金額だけ変えるときも)
  items?: NewItem[] | null;
  // 税の内訳の全置換。省略または null で変えない、[] で全部消す
  tax_lines?: NewTaxLine[] | null;
}

// GET /api/discounts?from=&to=&group_by=(none / merchant / category / month。既定 none)
// 数えるのは、レシートに印字された割引行(amount < 0 の明細)だけ。明細のない取引のマイナスは数えない
export interface DiscountRow {
  key: string;
  // 割引の合計(正の円)
  total: number;
  line_count: number;
  receipt_count: number;
}

export interface DiscountsData {
  group_by: "none" | "merchant" | "category" | "month";
  from: string | null;
  to: string | null;
  // 割引の合計(正の円)
  total: number;
  line_count: number;
  // 割引の行を持つ取引(レシート)の件数
  receipt_count: number;
  // 同じ期間の支出の合計(割合の参考)
  spend_total: number;
  // group_by=none のときは空。merchant・category は合計の大きい順、month は古い順
  rows: DiscountRow[];
  message: string;
}

// GET /api/deductions?from=&to=(確定申告の参考。税金の控除用フラグが付いた支出の合計だけ。控除の判定はしない)
export interface DeductionAmount {
  total: number;
  // 支出の行の数(明細のない取引は1行)
  count: number;
}

export interface DeductionsData {
  from: string | null;
  to: string | null;
  // セルフメディケーション税制(self_medication)の合計
  self_medication: DeductionAmount;
  // 医療費控除(medical)の合計。交通費(大分類が transport_group)を含む・含まない・その差
  medical: { including_transport: DeductionAmount; excluding_transport: DeductionAmount; transport: DeductionAmount };
  transport_group: string;
}

// GET /api/tax-summary?from=&to=&group_by=(rate / month。既定 rate)
// 集計は税の内訳(tax_lines)の印字どおりの数字だけ。明細の税率から税額は計算しない
export interface TaxableBasis {
  included_total: number;
  excluded_total: number;
  unknown_total: number;
}

export interface TaxSummaryRow {
  rate: number;
  // group_by=month のときだけ(YYYY-MM)
  month?: string;
  tax_total: number;
  taxable_total: number;
  // その税率の行を持つ取引の件数
  receipt_count: number;
  // 税額が記録されていない行の件数
  missing_tax_amount: number;
  taxable_basis: TaxableBasis;
  // 税込・税抜・不明のうち2種類以上が混ざっている
  mixed_basis: boolean;
}

export interface TaxSummaryData {
  group_by: "rate" | "month";
  from: string | null;
  to: string | null;
  // 税率の高い順(月別は月の古い順 → 税率の高い順)
  rows: TaxSummaryRow[];
  totals: { tax_total: number; taxable_total: number; receipt_count: number; taxable_basis: TaxableBasis; mixed_basis: boolean };
  coverage: {
    transactions: { count: number; total: number };
    with_tax_lines: { count: number; total: number };
    // 税の内訳が無い取引(集計に含まれていない支出)
    without_tax_lines: { count: number; total: number };
    lines_missing_tax_amount: number;
    lines_missing_taxable_amount: number;
  };
  message: string;
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
  description?: string;
  date?: string;
  transaction_id?: string;
  event_id?: string;
}

// PATCH /api/links/:id の入力(表題・説明文のどちらか1つ以上。渡した項目だけ変わる。null で消去)
export interface LinkPatch {
  title?: string | null;
  description?: string | null;
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

// GET /api/merchants?q=&category=&limit= の戻り。過去の取引から店名ごとにまとめた候補(入力中の絞り込み用)
// q: 店名・電話番号(数字だけでも可)・住所・カテゴリ名の部分一致。空なら、よく使う順。limit は既定8・最大20
// category: その店のいちばん多く使ったカテゴリがこれの店だけに絞る
// 並び: 店名の前方一致 → 件数の多い順 → 最後に使った日の新しい順
export interface MerchantView {
  merchant: string;
  count: number;
  last_date: string;
  category: string | null;
  account: string | null;
  phone: string | null;
  address: string | null;
  invoice_number: string | null;
  // この店で使った支払方法(口座名)・カテゴリ・印字されたレジ番号・店番号(店舗コード)の件数(多い順。最大5個)
  accounts: CountView[];
  categories: CountView[];
  register_nos: CountView[];
  store_codes: CountView[];
}

export interface CountView {
  value: string;
  count: number;
  last_date: string;
}

export interface MerchantsData {
  merchants: MerchantView[];
}

// ---- サブスク・保険などの固定費(別枠。支出の記録とは独立で、二重に数えない) ----
export type SubscriptionKind = "subscription" | "insurance" | "other";
export type SubscriptionPeriod = "monthly" | "yearly";
// 通貨。JPY(円)以外は外貨払い(小数点以下2桁の通貨)
export type Currency = "JPY" | "USD" | "EUR" | "GBP" | "AUD" | "CAD";

export interface SubscriptionView {
  id: string;
  name: string;
  kind: SubscriptionKind;
  // 1回の支払い額(円)。period が monthly なら月額、yearly なら年額。外貨のときは、外貨の金額×換算レートの四捨五入(目安の円)
  amount: number;
  period: SubscriptionPeriod;
  currency: Currency;
  // 外貨の金額(例: 20.5 = 20.50ドル)と換算レート(1外貨=何円。目安)。円のときは null
  foreign_amount: number | null;
  exchange_rate: number | null;
  // 外貨の金額を変えたとき、直前の外貨の金額
  previous_foreign_amount: number | null;
  // amount(円)が換算レートからの目安か(外貨のとき true)
  amount_is_estimate: boolean;
  // 月あたり・年あたりに直した金額(年払いの月あたりは、年額÷12の四捨五入)
  monthly_equivalent: number;
  yearly_equivalent: number;
  billing_month: number | null;
  billing_day: number | null;
  // 年払いで billing_month があるとき、次に払う月(YYYY-MM。今月を含む)
  next_billing_month: string | null;
  // 金額を変えたとき、直前の金額と変えた日
  previous_amount: number | null;
  amount_changed_on: string | null;
  // 金額を最後に確認した日
  price_checked_on: string | null;
  url: string | null;
  note: string | null;
  // true=契約中、false=解約済み(合計に入れない)
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionTotals {
  // 契約中の合計。月あたりは、年あたりの合計÷12の四捨五入
  monthly: number;
  yearly: number;
  count: number;
}

// GET /api/subscriptions?active=true|false&kind=(契約中の分が先、名前順)
export interface SubscriptionsData {
  count: number;
  subscriptions: SubscriptionView[];
  totals: SubscriptionTotals;
  message: string;
}

// POST /api/subscriptions の入力
// 円払いは amount、外貨払いは currency と foreign_amount と exchange_rate(amount は渡さない)
export interface NewSubscription {
  name: string;
  amount?: number;
  currency?: Currency;
  foreign_amount?: number;
  exchange_rate?: number;
  period: SubscriptionPeriod;
  kind?: SubscriptionKind;
  billing_month?: number;
  billing_day?: number;
  url?: string;
  note?: string;
  active?: boolean;
}

// PATCH /api/subscriptions/:id の入力(指定した項目だけ変える。billing_month / billing_day / url / note は null で消す)
export interface SubscriptionPatch {
  name?: string;
  amount?: number;
  currency?: Currency;
  foreign_amount?: number;
  exchange_rate?: number;
  period?: SubscriptionPeriod;
  kind?: SubscriptionKind;
  billing_month?: number | null;
  billing_day?: number | null;
  url?: string | null;
  note?: string | null;
  active?: boolean;
  // true で、金額を確認した日を今日にする
  price_checked?: boolean;
}

// POST / PATCH の戻り
export interface SubscriptionData {
  subscription: SubscriptionView;
  message: string;
}

// DELETE の戻り
export interface DeletedSubscriptionData {
  deleted: SubscriptionView;
  message: string;
}

// GET /api/compare?month=&base=&group_by=&until_day=。月の比較(base は previous / year_ago / YYYY-MM)
export interface CompareRowView {
  key: string;
  label: string;
  total: number;
  base_total: number;
  diff: number;
  diff_percent: number | null;
}
export interface CompareData {
  month: string;
  base_month: string;
  group_by: "group" | "category";
  until_day: number | null;
  period: { from: string; to: string };
  base_period: { from: string; to: string };
  total: number;
  base_total: number;
  diff: number;
  diff_percent: number | null;
  count: number;
  base_count: number;
  rows: CompareRowView[];
}

// GET /api/search?q=&from=&to=&types=&limit=&offset=(types はカンマ区切り)。記録の横断検索。新しい日付から
export type SearchHitType = "transaction" | "event" | "seat_record" | "link" | "photo";
export interface SearchHitView {
  type: SearchHitType;
  id: string;
  date: string;
  title: string;
  detail: string | null;
  amount: number | null;
  transaction_id: string | null;
}
export interface SearchData {
  query: string;
  total: number;
  latest_date: string | null;
  count: number;
  offset: number;
  has_more: boolean;
  hits: SearchHitView[];
}

// GET /api/usage。D1 の使用量(Cloudflare の分析 API から。UTC の日付)。設定がなければ configured: false。取得に失敗したら 502(errors)
export type UsageLevel = "ok" | "warn" | "danger";
export interface UsageDayView {
  date: string;
  rows_read: number;
  rows_written: number;
  read_queries: number;
  write_queries: number;
}
export interface UsageMeterView {
  used: number;
  limit: number;
  ratio: number;
  level: UsageLevel;
}
export type UsageData =
  | { configured: false; missing: string[]; message: string }
  | { configured: true; days: UsageDayView[]; today: UsageDayView; rows_read: UsageMeterView; rows_written: UsageMeterView; level: UsageLevel; fetched_at: string; message: string };

// GET /api/products?from=&to=&q=&limit=。商品ごとの集計(金額の大きい順)。product は統一した商品名(無ければ品名)
export interface ProductRowView {
  product: string;
  lines: number;
  quantity: number;
  amount: number;
  last_date: string;
  jan_code: string | null;
  has_unit_price: boolean;
  content_total: { amount: number; unit: ContentUnit } | null;
}
// GET/POST/PUT/DELETE /api/product-groups。商品の「まとめ名」(表記ゆれ・似た商品を1つにくくる)
export interface ProductGroupView {
  id: string;
  name: string;
  words: string[];
}
export interface ProductGroupsData {
  groups: ProductGroupView[];
}
export interface ProductGroupSaved {
  group: ProductGroupView;
  message: string;
}
export interface ProductGroupDeleted {
  id: string;
  message: string;
}
// GET/POST/DELETE /api/search-chips。検索の「よく使う検索」チップ
export interface SearchChipView {
  id: string;
  label: string;
  q: string;
  type: SearchHitType | null;
}
export interface BackupStatusData {
  ok: true;
  last_backup_at: string | null;
  days_since: number | null;
  has_data: boolean;
  remind: boolean;
}

export interface NoticeView {
  id: string;
  level: "info" | "warn" | "danger";
  title: string;
  body: string;
  href: string;
}

export interface NoticesData {
  ok: true;
  notices: NoticeView[];
}

export interface SearchChipsData {
  chips: SearchChipView[];
}
export interface SearchChipSaved {
  chip: SearchChipView;
  message: string;
}
export interface SearchChipDeleted {
  id: string;
  message: string;
}
// GET/POST/DELETE /api/product-excludes。商品の集計に入れない言葉
export interface ExcludeWordView {
  id: string;
  word: string;
}
export interface ExcludesData {
  excludes: ExcludeWordView[];
}
export interface ExcludeSaved {
  exclude: ExcludeWordView;
  message: string;
}
export interface ExcludeDeleted {
  id: string;
  message: string;
}
export interface ProductsData {
  count: number;
  total: number;
  products: ProductRowView[];
  message: string;
}

// GET /api/products/history?product=&from=&to=。1つの商品の、月ごとの購入数・単価の推移と、買い物の一覧
export interface ProductMonthView {
  month: string;
  lines: number;
  quantity: number;
  amount: number;
  unit_price: UnitPrice | null;
}
export interface ProductPurchaseView {
  date: string;
  transaction_id: string;
  merchant: string | null;
  name: string;
  quantity: number;
  amount: number;
  content_amount: number | null;
  content_unit: ContentUnit | null;
  unit_price: UnitPrice | null;
}
export interface ProductUnitPriceSummary {
  unit: ContentUnit;
  latest: { per_unit: number; date: string };
  cheapest: { per_unit: number; date: string; merchant: string | null };
  average: number;
}
export interface ProductHistoryData {
  product: string;
  jan_codes: string[];
  lines: number;
  quantity: number;
  amount: number;
  months: ProductMonthView[];
  unit_price: ProductUnitPriceSummary | null;
  purchases: ProductPurchaseView[];
  message: string;
}

