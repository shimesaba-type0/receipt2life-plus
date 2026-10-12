# Web UI 用 API(契約)

Web UI(`ui/`)と、Worker の `/api/*`(`src/api/`)の取り決めです。型は `src/api/contract.ts` が正です(この文書はその説明)。
すべて認証の内側(Cloudflare Access の JWT。`src/auth/access.ts`)。個人用なので、データはユーザーごとに分けません。

## 共通

- 成功: `{"ok": true, ...}`、失敗: `{"ok": false, "errors": [{"index"?, "field", "message"}]}`(`message` は日本語で、直せる具体的な文)
- 検証エラーは HTTP 400、存在しない id は 404、本文が大きすぎるときは 413、写真のアップロードで `Content-Length` が無いときは 411、認証失敗は 401(Access の前段で止まる場合は UI 側に通信エラーとして見える)
- 日付は `YYYY-MM-DD`、月は `YYYY-MM`、基準は Asia/Tokyo。金額は円の整数
- ロジックは `src/core` の関数を呼ぶ。API にロジックを書かない(MCP と同じ関数を使う)
- 未定義の `/api/*` は、画面(SPA)ではなく 404 の JSON

## 読み取り

| メソッド・パス | 戻り(`ok:true` に続けて) |
| --- | --- |
| `GET /api/home` | `HomeData`: 今日と今月の合計、大分類別(`summarize` の group)、メモ付き支出の割合、要確認の件数、最近の取引10件 |
| `GET /api/calendar?month=YYYY-MM` | `CalendarData`: その月の日別の合計・件数・写真枚数(取引のある日だけ)、その月と重なる出来事。`month` 省略は今月 |
| `GET /api/day/:date` | `DayData`: その日の合計・取引一覧(各取引に `items`)・重なる出来事・写真・リンク(`links: LinkView[]`。日付そのもの、その日の取引、その日と重なる出来事に紐づくもの) |
| `GET /api/transactions/:id` | `TransactionDetailData`: 取引(`items` つき)、その取引に紐づく写真(`photos`)とリンク(`links`)、件数 `counts: {items, photos, links}`。無い id は 404 |
| `GET /api/categories` | `CategoriesData`: カテゴリ(`name`=サブカテゴリ、`group_name`=大分類、`icon`=アイコンのキー(未設定は `null`)、`usage`=使っている取引と明細の行の件数。大分類ごと・追加順)と口座名(`accounts: string[]`。口座の件数つきの一覧は `GET /api/accounts`) |
| `GET /api/accounts` | `AccountsData`: 口座(支払方法)の一覧(`accounts: {name, usage}[]`。`usage`=使っている取引の件数。追加順) |

## 取引

| メソッド・パス | 入力 | 戻り |
| --- | --- | --- |
| `POST /api/transactions` | `{transactions: NewTransaction[]}`(`add_transactions` と同じ。`items` で明細つき) | `registered`(各取引に `items`。カテゴリを引き継いだときは `applied_default_category`), `skipped_duplicates`, `message` |
| `PATCH /api/transactions/:id` | `TransactionPatch`(`update_transaction` と同じ。null で空にできる。`items` は全置換) | `transaction`(`items` つき), `warnings`, `message` |
| `DELETE /api/transactions/:id[?delete_photos=1]` | なし | `TransactionDeleted`: `deleted: {transaction, items, photos, links}`(消した件数), `message`。写真が紐づく取引は、`delete_photos=1` が無ければ 400 で拒否 |

### 明細(`items`)

レシートの下に、品名・金額の行を持てる。明細は任意で、無い取引は今までどおり1行の支出として扱う。

- `ItemView`: `id`, `position`(0始まりの並び順), `name`, `amount`(円。マイナスは値引き、0は無い), `category`, `tax_flag`, `memo`。`category` / `tax_flag` は**行自身の値**で、`null` の行は取引の `category` / `tax_flag` に従う(実効値 = 行の値 ?? 取引の値)
- `TransactionView.items`: 常に含まれる(明細なしは `[]`)。`POST` / `PATCH` の戻り、`GET /api/day/:date`、`GET /api/home` の `recent`、`GET /api/transactions/:id`
- 合計: 明細がある取引は「明細の `amount` の合計 = 取引の `amount`」が必須。合わなければ 400(`POST` は `field: "items"`、`PATCH` で金額だけを変えたときは `field: "amount"`)で、差額の文が返る
- 入力(`NewItem`): `name`(必須、100文字まで)、`amount`(必須、整数、0以外、絶対値10,000,000以下)、`category?`、`tax_flag?`、`memo?`。1取引50行まで
- `PATCH` の `items`: 全置換。省略または `null` で変えない、`[]` で全部消す
- 全部同じカテゴリなら、取引の `category` だけを付けて行の `category` は空にする
- `status`: 店名が無い、または実効カテゴリの無い行が1つでもあれば `needs_review`
- カテゴリの引き継ぎ: `category` を省略し、カテゴリの無い行がある(明細なしなら取引そのもの)とき、同じ店名(表記ゆれは吸収)の直近の取引のカテゴリを使い、`registered[].applied_default_category` で知らせる
- 集計(ホームの大分類別の内訳)は明細の行ごとの実効カテゴリで数える。今日・今月の合計と件数、カレンダー・日の合計と件数は取引(レシート)で数える
- 削除: 明細とリンクは取引といっしょに消える。写真は `?delete_photos=1` のときだけ(R2 の実体が先、行が後)

### 税金の控除用フラグ(`tax_flag`)

確定申告の準備のため、支出に控除用のフラグを1つ付けられる。**金額の記録と集計だけ**で、控除の対象になるか・控除額・上限の判定はしない(利用者の責任)。

- 値: `medical`(医療費控除)、`self_medication`(セルフメディケーション税制)、`donation`(寄附金控除)。フラグなしは `null`。ラベルは `src/core/tax-flags.ts` の `TAX_FLAG_LABELS` が正で、UI は `ui/src/taxFlags.ts` に同じ文言を持つ(テストで一致を確かめる)
- `TransactionView.tax_flag`: 常に含まれる(なしは `null`)。`GET /api/day/:date` と `GET /api/home` の取引にも含まれる
- `NewTransaction.tax_flag`: 省略または `null` でフラグなし。`TransactionPatch.tax_flag`: 省略は変更なし、`null` で解除
- 不正な値は 400(`field: "tax_flag"`)。重複判定(`dedup_hash`)には含めない
- 年ごとの合計は、MCP の `summarize`(`group_by: "tax_flag"` と `from` / `to`)で出す。Web UI の API には集計用の道は足していない
- 明細の行にもフラグを付けられる(行の `tax_flag`、`null` なら取引のフラグに従う)。集計は行ごとの実効フラグで数える

## レシートの情報(決済時刻・店の連絡先・登録番号など)

後から店に問い合わせる(例: タクシーの領収書)ために、レシートに印字された情報を取引ごとに持てる。すべて任意で、無い取引は今までどおり。検証と正規化は `src/core/receipt-details.ts` の Zod スキーマ1つ(`POST` / `PATCH` / MCP / JSONL の取り込みが共通)。

| 項目 | 規則 |
| --- | --- |
| `paid_time` | 決済時刻。日本時間の `HH:MM`(00:00〜23:59)。日付は `date` |
| `merchant_phone` | 店の電話番号。数字・ハイフン・括弧・プラス・空白のみ、30文字まで。全角は半角に、前後の空白は除いて保存 |
| `merchant_address` | 店の住所。200文字まで |
| `invoice_number` | 適格請求書発行事業者の登録番号。全角・小文字の t・ハイフンや空白入りは正規化し、`T` + 数字13桁でなければ 400(「T と数字13桁で入力してください」) |
| `clerk_name` | 対応した店員の名前(担当・責任者・レジ)。50文字まで |
| `receipt_no` | レシート番号・伝票番号。50文字まで |

- `TransactionView` に常に含まれる(なしは `null`)。`GET /api/transactions/:id`、`GET /api/day/:date`、`GET /api/home` の取引、`POST` / `PATCH` の戻りにも含まれる
- `NewTransaction`: 省略または `null` で値なし。`TransactionPatch`: 省略は変更なし、`null` で空にする(空文字は 400)
- 重複判定(`dedup_hash`): `paid_time` がある取引は `日付|金額|店名|時刻`。時刻が違えば、同じ日・同じ店・同額でも別の取引として登録できる。時刻なしは従来どおり
- `GET /api/day/:date` の `transactions` は、決済時刻の昇順(時刻なしは末尾、同じ時刻・時刻なしどうしは登録順)
- 検索の `keyword` は MCP の `list_transactions` にある(Web UI 用の API には足していない)

## カテゴリ(大分類の下のサブカテゴリ)

Zaim のように、大分類(`group_name`)の下にサブカテゴリ(`name`)が並ぶ。取引が参照するのはサブカテゴリ(`name` は全体で一意)。大分類は独立した表を持たず、`group_name` が同じカテゴリのまとまり。ロジックは `src/core/categories.ts`(MCP の `add_category` / `update_category` / `delete_category` / `rename_group` と同じ関数)。

| メソッド・パス | 入力 | 戻り |
| --- | --- | --- |
| `POST /api/categories` | `NewCategory`(`name` 30文字まで、`group_name` 20文字まで。どちらも前後の空白は除く。`icon?`) | `category`, `created_group`, `message` |
| `PATCH /api/categories/:name` | `CategoryPatch`(`new_name?`, `group_name?`, `icon?`(`null` で外す)。1つ以上必要) | `category`, `created_group`, `message` |
| `DELETE /api/categories/:name?move_to=` | なし | `deleted`, `moved`, `move_to`, `message` |
| `POST /api/category-groups/rename` | `GroupRename`(`group`, `new_name`) | `group`, `previous`, `updated`, `merged`, `message` |

- `:name` は URL エンコードしたカテゴリ名(日本語。例: `/api/categories/%E9%A3%9F%E8%B2%BB`)。パスの `name` が本文の `name` に優先する
- 名前の重複・空・長すぎる・変更なしは 400(`field` は `name` / `new_name` / `group_name` / `input`)。存在しないカテゴリ(`name`)・大分類(`group`)は 404。`move_to` が存在しない・自分自身は 400
- 削除: 取引・明細の行が1件も使っていなければそのまま削除。使っているのに `move_to` が無ければ 400(「N件の支出が使っています。move_to で移し先を指定してください」)。`move_to` があれば取引と明細の行のカテゴリを付け替えてから削除(1回のバッチ)。最後の1つのカテゴリは削除できない(400)
- 大分類の名前の変更(`rename`): その大分類の全カテゴリの `group_name` を更新する。既にある別の大分類と同名にすると統合(`merged: true`)。確認なしで実行され、変更したカテゴリの件数を `updated` で返す
- `icon` は `src/core/category-icons.ts` の31個のキー(`food`, `cafe`, … `other`。一覧とラベルは `docs/connect-claude.md`)のどれか。一覧にない値は 400(`field: "icon"`、選べるキーを日本語で返す)。省略は未設定(`null`。画面では `other` と同じ見た目)。PATCH で省略すると変えない、`null` で外す
- カテゴリの名前・大分類を変えても、取引の `category_id` 参照は変わらないので、取引の `status` / `dedup_hash` への影響はない
- JSON を受ける POST / PATCH は `application/json` 以外を 415、書き込みは同一オリジンのみ(他は取引・出来事と同じ)。応答は `Cache-Control: private, no-store`

## 口座(支払方法)

現金・カード・Suica など。取引の `account` は口座の名前で引く(`name` は全体で一意)。未知の口座名での登録・修正は今までどおりエラー(選べる値を返す)で、自動では増えない。ロジックは `src/core/accounts.ts`(MCP の `add_account` / `update_account` / `delete_account` と同じ関数)。

| メソッド・パス | 入力 | 戻り |
| --- | --- | --- |
| `POST /api/accounts` | `NewAccount`(`name` 30文字まで。前後の空白は除く) | `account`, `message` |
| `PATCH /api/accounts/:name` | `AccountPatch`(`new_name`。必須) | `account`, `message` |
| `DELETE /api/accounts/:name?move_to=` | なし | `deleted`, `moved`, `move_to`, `message` |

- `:name` は URL エンコードした口座名。パスの `name` が本文の `name` に優先する
- 名前の重複・空・長すぎる・変更なしは 400(`field` は `name` / `new_name`)。存在しない口座(`name`)は 404。`move_to` が存在しない・自分自身は 400
- 名前の変更は、取引が口座のIDで参照しているので、取引の表示に自動で反映される
- 削除: 取引が1件も使っていなければそのまま削除。使っているのに `move_to` が無ければ 400(「N件の支出が使っています。move_to で移し先の口座を指定してください」)。`move_to` があれば取引の口座を付け替えてから削除(1回のバッチ)。カテゴリと違い、最後の1つでも(使われていなければ)削除できる(取引の口座は任意のため)
- JSON を受ける POST / PATCH は `application/json` 以外を 415、書き込みは同一オリジンのみ。応答は `Cache-Control: private, no-store`

## 出来事(日付や期間のメモ)

| メソッド・パス | 入力 | 戻り |
| --- | --- | --- |
| `POST /api/events` | `NewEvent` | `event`, `message` |
| `PATCH /api/events/:id` | `EventPatch` | `event`, `message` |
| `DELETE /api/events/:id` | なし | `deleted`, `message`(紐づく写真があれば 400 で拒否) |

出来事の削除は、MCP には無い(UI 専用)。`core` に `deleteEvent` を足して使う。

## リンク(Xの投稿・YouTubeの動画)

日付・取引・出来事に、外部リンクを付ける。Worker から外のサイトへは取りに行かない(タイトル取得も埋め込みもしない)。URLの検証と正規化は `src/core/links.ts`。

| メソッド・パス | 入力 | 戻り |
| --- | --- | --- |
| `POST /api/links` | `NewLink`(`url` 必須、`title?`、`date?` / `transaction_id?` / `event_id?` のうち1つ以上) | `link: LinkView`, `duplicate`, `message` |
| `PATCH /api/links/:id` | `LinkPatch`(`title` のみ。null で消去) | `link`, `duplicate: false`, `message` |
| `DELETE /api/links/:id` | なし | `deleted`, `message` |

- `LinkView`: `id`, `url`(正規化済み), `kind`(`x` / `youtube`), `title`, `date`, `transaction_id`, `event_id`, `created_at`(無い項目は null)
- URL: https のみ。`user:pass@` と、443 以外のポートは不可。最大2048文字。ホストは完全一致の許可リスト
  - X(`kind=x`): `x.com` / `www.x.com` / `mobile.x.com` / `twitter.com` / `www.twitter.com` / `mobile.twitter.com`。パスは `/<ユーザー名>/status/<数字>`(投稿)か `/<ユーザー名>`(プロフィール)
  - YouTube(`kind=youtube`): `youtube.com` / `www.youtube.com` / `m.youtube.com` / `music.youtube.com`(`/watch?v=<ID>`、`/shorts/<ID>`、`/live/<ID>`、`/playlist?list=<ID>`)と `youtu.be/<ID>`
- 正規化: `#` 以降を消す、`utm_*` / `si` / `fbclid` / `feature` を消す(Xは `s` / `t` も消す。YouTubeの `t`(開始位置)は残す)、ホストは小文字(入力のホストのまま保存)
- 重複: 同じ紐づけ先(date・transaction_id・event_id が全部同じ)に同じ正規化URLがあれば、登録せず既存のリンクを `duplicate: true` で返す(200)
- 紐づけ先の取引・出来事が存在しなければ 400。存在しないリンクの id は 404
- 取引・出来事を削除すると、紐づくリンクもいっしょに消える(リンクがあっても削除は拒否しない)。MCP には `add_link` / `list_links` / `delete_link`

## 写真

写真の実体は R2(`PHOTOS`)。**公開しない**。配信は、認証を通した Worker 経由。

| メソッド・パス | 内容 |
| --- | --- |
| `POST /api/photos` | `multipart/form-data`。`file`(必須)と、`date` / `transaction_id` / `event_id` / `caption`(`date`・`transaction_id`・`event_id` のうち1つ以上が必要)。戻り: `photo: PhotoView` |
| `GET /api/photos/:id` | R2 から読んで返す。`Content-Type` は保存時に検証した値。ヘッダー: `Content-Disposition: inline`、`X-Content-Type-Options: nosniff`、`Cross-Origin-Resource-Policy: same-origin`、`Content-Security-Policy: default-src 'none'; sandbox`、`Cache-Control: private, max-age=31536000, immutable`(画像は更新しない) |
| `DELETE /api/photos/:id` | R2 のオブジェクトと、attachments の行を消す。複数削除の API は無く、画面は1枚ずつ DELETE を呼ぶ |

- 受け付ける画像: JPEG / PNG / WebP。**拡張子や申告の Content-Type を信用せず、先頭のバイト列(マジックナンバー)で判定する**
- サイズ上限: 5MB(ブラウザ側で、長辺1600px程度に縮小してから送る前提。それでも超えたら 413)。`Content-Length` が無いリクエストは 411
- R2 のキー: `photos/<YYYY>/<uuid>`(ファイル名など、利用者の入力をキーに使わない)
- 参照先(取引・出来事)が存在しなければ 400。attachments の行の作成と R2 への保存は、片方だけ残らないようにする(R2 に保存してから行を作り、行の作成に失敗したら R2 を消す)

## エクスポート・インポート

`GET /export`(JSONL)、`POST /import`。docs/backup.md を参照。

ブラウザからは `/backup` 画面で操作できる(ダウンロードは `/export`、読み込みは `/import` を画面が呼ぶ)。画面は読み込みの前に上限(5MB・5000 行)だけ検査し、中身の判定はサーバーに任せる。
