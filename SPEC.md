# receipt2life+ 仕様書

日々の支出を中心に、出来事や思い出も一緒に記録できる、自分専用のライフログアプリ。
入力は主にAI(Claude、ChatGPT)からMCPで行い、見返しは専用のWeb UIで行う。

## 0. Claude Codeへの指示

- このファイルを `SPEC.md` として置き、これを正とする。`CLAUDE.md` を作り、この節と第12節、開発コマンドを要約して置く
- 実データと秘密は、コードにもテストにもドキュメントにも書かない。`.dev.vars` は絶対にコミットしない
- 本番へのデプロイ、本番D1へのマイグレーション、Accessの設定変更は、エージェントが手元で行わない(人間が行う)。デプロイはCI(`.github/workflows/ci.yml`、`docs/ci-cd.md`)だけが行う。ステージングは、指示があったときだけ触る
- 仕様にない判断は、第13節に追記して暫定で進める。大きな分岐は質問する
- 各フェーズは、テストを先に書いて実装し、完了条件を満たしたらコミットする
- 依存は最小限にする。ライセンスがAGPL-3.0と矛盾しないもの(MIT、Apache-2.0、BSDなど)だけ使う
- Hono、MCP SDK、Wrangler、Astroの使い方は、記憶に頼らず最新の公式ドキュメントを確認する
- 識別子とコードは英語。README、コミットメッセージ、コメントは日本語でよい
- 完了条件は常に `npm run check`(型チェック、lint、vitest、build)が通ること

## 1. 概要

- 記録の中心は日々の支出。レシート写真、手入力、音声の3経路で登録する
- ライフログとして、日付や期間のメモ(5色)と、任意の写真(半券、チケット、イベントのレシートなど)を残す
- レシートが出ない支出は記録しない運用なので、集計は「記録した範囲の傾向」とみなす
- 価値は、今日と今月の支出に気づくことと、支出が思い出の索引になること。節約を促す機能(予算超過の警告など)は入れない
- 表示名は receipt2life+。リポジトリ、Worker、D1、R2の識別子は `receipt2life`(「+」は使えない)
- 利用者は作者1人。ソースは公開し、フォークは自由。プルリクエストは受けず、Issueは受ける

## 2. 設計方針

- AIとMCPは入口のレイヤーの1つ。核は支出、出来事、写真のデータと、それを扱う関数
- 核(検証、保存、集計)はAIを持たない。画像の読み取り、複数レシートの切り分け、カテゴリ判断はチャット側のAIが行う。Workers AIは使わない
- ツールのロジックはMCPのハンドラーに書かず、核の関数に置く。MCPもWeb UIのAPIも同じ関数を呼ぶ
- Zodのスキーマ1つで、MCPの入力定義、APIの検証、型を兼ねる
- 認証は差し替え可能にする
- 定型のUIは自作して固定する。凝った分析はUIに作り込まず、チャット側に任せる

## 3. アーキテクチャと技術スタック

```
Claude / ChatGPT ──(MCP, Managed OAuth)──┐
ブラウザ(PWA) ────(Accessのログイン)─────┤
                                          ▼
                            Cloudflare Access(JWTを付与)
                                          ▼
        Worker(Hono): /mcp   /api と静的UI   /export /import
                                          ▼
                            核(Zod検証・保存・集計)
                                ▼                 ▼
                           D1(SQLite)          R2(写真)
```

| 要素 | 採用 |
| --- | --- |
| 言語 | TypeScript |
| バックエンド | Hono(Worker 1本)。`app.request()` でテストする |
| UI | Astro(静的ビルド、SSRなし)をWorkers Assetsで配信。PWA対応。動く部分は島で書く |
| データ | D1(取引、出来事など)、R2(写真) |
| 検証 | Zod |
| テスト | vitest(ローカルD1を使う) |
| 認証 | Cloudflare Access(MCPはManaged OAuth) |

## 4. ディレクトリ構成(提案)

```
receipt2life/
├ src/
│  ├ core/     ドメイン関数とZodスキーマ(HTTPやMCPに依存しない)
│  ├ auth/     getIdentity、JWT検証、開発用の差し替え
│  ├ mcp/      MCPツール(coreを呼ぶだけ)
│  ├ api/      Web UI向けのAPI
│  ├ io/       エクスポートとインポート
│  └ index.ts  Honoのエントリ
├ ui/          Astro
├ migrations/  D1のマイグレーション
├ tests/       fixtures/ にはダミーデータだけ置く
├ docs/setup.md  人間がやる作業の手順(第12節)
├ wrangler.toml  値はプレースホルダー
├ .dev.vars.example
└ SPEC.md CLAUDE.md README.md SECURITY.md LICENSE
```

## 5. データモデル

日付は `YYYY-MM-DD`(未指定なら今日)、時刻はUTCのISO 8601、タイムゾーンの基準は Asia/Tokyo。IDはULIDかUUID。

**transactions**

| 列 | 型・制約 | 備考 |
| --- | --- | --- |
| id | TEXT PK | |
| date | TEXT NOT NULL | |
| amount | INTEGER NOT NULL | 円。マイナス(返金)の扱いは未決 |
| merchant | TEXT | 店名。任意 |
| category_id | TEXT | categoriesへのFK。任意 |
| account_id | TEXT | accountsへのFK。任意 |
| memo | TEXT | |
| source | TEXT NOT NULL | receipt / manual / voice |
| status | TEXT NOT NULL DEFAULT 'ok' | ok / needs_review |
| dedup_hash | TEXT NOT NULL | 日付+金額+正規化した店名のSHA-256(paid_time があれば時刻も含める)。索引は付けるが、UNIQUEにはしない |
| created_at, updated_at | TEXT | |

- 必須は金額だけ。読み取れなかった項目は空欄のまま登録でき、不完全なものには needs_review を付ける
- レシートに印字された情報(決済時刻 paid_time、店の電話 merchant_phone・住所 merchant_address、登録番号 invoice_number、担当者 clerk_name、レシート番号 receipt_no、レジ番号 register_no、店番号 store_code)は、すべて任意の列で持つ(migration 0006、register_no / store_code は migration 0013。第13節「フェーズ5(レシートの情報)」)
- 明細(レシートの行)は任意で、transaction_items に持つ(第13節「フェーズ5(明細)」)。取引の amount が支払総額の正

**transaction_items**(明細。migration 0005)

| 列 | 型・制約 | 備考 |
| --- | --- | --- |
| id | TEXT PK | |
| transaction_id | TEXT NOT NULL | transactionsへのFK |
| position | INTEGER NOT NULL | 並び順(0始まり)。索引は (transaction_id, position) |
| name | TEXT NOT NULL | 品名。100文字まで |
| amount | INTEGER NOT NULL CHECK(amount != 0) | 円。マイナスは値引き。絶対値は10,000,000以下 |
| category_id | TEXT | categoriesへのFK。NULLなら取引のカテゴリに従う |
| tax_flag | TEXT | transactions.tax_flag と同じ値。NULLなら取引のフラグに従う |
| memo | TEXT | |
| created_at | TEXT NOT NULL | |
| tax_rate | REAL CHECK(0〜100) | 消費税の税率(%)。レシートの印字どおり。小数可。NULL=不明(migration 0012)。tax_flag とは別物 |
| tax_label | TEXT CHECK(20文字まで) | 印字どおりの税率の記号(「※」「軽」など)。任意(migration 0012) |

**transaction_tax_lines**(税の内訳。レシート下部の税率別の内訳。migration 0012)

| 列 | 型・制約 | 備考 |
| --- | --- | --- |
| id | TEXT PK | |
| transaction_id | TEXT NOT NULL | transactionsへのFK(ON DELETE CASCADE。core でも明示して消す)。索引あり |
| rate | REAL NOT NULL CHECK(0〜100) | 税率(%)。印字どおり。(transaction_id, rate) は UNIQUE |
| taxable_amount | INTEGER | その税率の対象金額(円)。印字が無ければ NULL |
| tax_amount | INTEGER | その税率の消費税額(円)。印字が無ければ NULL |
| amount_basis | TEXT CHECK IN ('included','excluded') | 対象金額が税込か税抜か。印字から分かる場合だけ |
| label | TEXT CHECK(20文字まで) | 印字の記号 |
| created_at | TEXT NOT NULL | |

**categories**: id, name(UNIQUE), group_name(集計用の大分類)。初期データは seed で入れる(例: 食費、日用品、交通・チャージ、娯楽、その他)
**accounts**: id, name(UNIQUE)。現金、カード、Suica程度のラベル。残高は持たない
**events**: id, start_date, end_date(単日はNULL), title, note, color(red / orange / green / blue / purple のいずれか。色コードはUI側)
**attachments**: id, r2_key, date, transaction_id, event_id, caption, created_at。date、transaction_id、event_id のうち1つ以上を持つ
**venues**(会場。migration 0010): id, name(UNIQUE。完全一致), created_at
**screens**(スクリーン・ホール・エリア。映画館のスクリーンに限らず、ホール・ブロック・エリアなどの区画。migration 0010): id, venue_id(venues への FK), name, note(そのスクリーンの特徴。任意。例「前方は首が疲れる」), created_at。(venue_id, name) は UNIQUE
**seat_records**(座席の記録。migration 0008、`title` は 0009、会場・スクリーンの切り出しは 0010、`seat_class` は 0011): id, date(必須), title(作品名・公演名。任意), venue_id(必須。venues への FK), screen_id(任意。screens への FK), seat(必須), seat_class(席種。任意。プレミアムシート、内野指定席、ボックスシートなど。50文字まで), rating(1〜5), note, transaction_id(取引が消えたらNULL), created_at。旧い `venue` / `screen`(文字列)の列は 0010 で venues / screens に移して無くなった。入出力は従来どおり venue / screen を名前で受け渡す。第13節「フェーズ5(座席の記録)」「会場とスクリーンを別レコードに分けた」

収入は持たない(後から取引に種別の列を足す)。

## 6. MCPツール

Streamable HTTPで、ステートレスに実装する。ツールの説明文とスキーマがAIへの仕様書になるので、項目の意味、必須と任意、選べる値を必ず書く。

現在は30個(取引4、集計・参照3、カテゴリ管理4、口座管理3、出来事3、写真3、リンク3、座席の記録4、会場・スクリーン3)。`src/mcp/tools/*` が正。

| ツール | 役割 |
| --- | --- |
| add_transactions | 取引を配列で登録。1レシート1件。写真1枚に複数のレシートがあれば、別々の取引にする。明細(items)を行ごとに付けられる。全件成功か全件ロールバック(D1のbatch) |
| list_transactions | from、to、category、tax_flag、keyword(任意)で一覧。明細(items)つき |
| update_transaction / delete_transaction | 修正(明細は全置換)と削除(delete_photos で写真もいっしょに) |
| summarize | 期間と group_by(category、group、month、merchant、event_id、tax_flag)で集計。単位は支出の行。件数、合計、全体に対する割合 |
| summarize_tax | 期間と group_by(rate=税率別、month=月別×税率別)で、レシートに印字された消費税額・対象金額を合計する。集計は tax_lines の数字だけ。税の内訳が無い支出の件数・金額(カバレッジ)を必ず返す |
| list_categories | AIが既存カテゴリに寄せるために使う。大分類ごとのまとまりと使用数つき |
| add_category / update_category / delete_category / rename_group | カテゴリ(大分類の下のサブカテゴリ)の管理 |
| add_account / update_account / delete_account | 口座(支払方法)の管理。未知の口座名での登録はエラーのまま(自動追加しない) |
| add_event / update_event / list_events | 日付や期間のメモ(色つき) |
| create_photo_upload_link / list_photos / get_photos | 写真の登録は Web UI の /photos/add へのリンクを返す。一覧と画像の取得 |
| add_link / list_links / delete_link | Xの投稿・YouTubeの動画のリンク |
| add_seat_record / list_seat_records / update_seat_record / delete_seat_record | 映画館・球場などの座席の記録(会場・スクリーン/エリア・座席・席種 `seat_class`・評価1〜5・一言)。`seat_class` は席種で、一覧は部分一致で絞り込める。venue / screen は名前で受け、無ければ会場・スクリーンを自動で作る(応答の `created_venue` / `created_screen`)。一覧は venue・screen・seat ごとの平均評価(summary)つき。次の席選びの参考にする |
| list_venues / update_venue / update_screen | 会場とその下のスクリーン(ホール・ブロック・エリアなどの区画)の一覧(記録件数・平均評価・スクリーンの特徴 note つき)、会場名の変更、スクリーン名の変更と note の設定・消去。削除のツールはない。登録前に `list_venues` で既存の名前を確かめ、新しい名前を作る前にユーザーに確認する |
| query(未実装・候補) | 読み取り専用のSELECT。行数上限あり。現在のツール30個には含まれない。入れるかは第13節の未決事項 |

- **重複**: dedup_hash が既存と一致したら、登録せずに既存のIDを返して警告する。同日同額の正当な購入があり得るので、`allow_duplicate: true` で強制登録できるようにする
- **検証**: 金額は整数、日付はISO形式、未来日付と極端な金額は拒否。エラーは何が悪いかを文章で返し、AIが直して再送できるようにする
- **登録後の応答**: 「3件登録しました: A店 1,280円 / B店 540円 / 駐車場 800円」のように一覧を返す
- **よく使う型**(駐車場、Suicaチャージ、自販機)は、カテゴリと口座の既定値を説明文に書く
- 画像の実体はMCPに渡らない。写真の添付はWeb UIから行う

入力の例:

```json
{"transactions":[{"date":"2026-10-11","amount":1280,"merchant":"A店","category":"食費","account":"現金","source":"receipt"}]}
```

エラーの例:

```json
{"ok":false,"errors":[{"index":0,"field":"amount","message":"amount は整数(円)で指定してください"}]}
```

## 7. 認証とセキュリティ

方針(第一候補): 認証はCloudflare Accessに任せ、Workerは `Cf-Access-Jwt-Assertion` のJWT検証だけを行う。

- ブラウザは通常のAccessログイン。MCPクライアントはManaged OAuth(RFC 8707対応のクライアントが必要。DCRの許可リストにコールバックURLをhttpsで登録する)
- `/mcp`、`/api`、`/export`、`/import`、静的UIはすべて認証必須
- **フェイルクローズ**: JWT検証の設定(`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`)が空なら、全リクエストを拒否する。この認証ミドルウェアは最初のフェーズから入れる
- workers.devのURLとプレビューURLは無効にするか、Accessで守る。それでもJWT検証は必須
- 認証は `getIdentity()` に切り出し、差し替え可能にする

テストの設計:

| 目的 | 方法 |
| --- | --- |
| ツールのロジック | 認証を通さず、ハンドラーを直接呼ぶ。テストでは固定の本人を返す |
| ローカルの動作確認 | `.dev.vars` の `AUTH_BYPASS=1` があり、かつホストがlocalhostのときだけ素通りにする。本番にこの変数は置かない |
| JWT検証 | テスト用の鍵ペアで署名し、JWKSを差し替える。正常、期限切れ、audience違い、issuer違い、ヘッダーなしを確認する |
| ステージングのE2E | 資格情報なしは401、不正なトークンは拒否、サービストークンなら通る |

- ステージングは別のAccessアプリ(Service Authポリシー、サービストークン)、別のD1とR2にする。エージェントに渡す資格情報はステージング専用
- サービストークンで入ったときのJWTにはメールが入らないはず(要確認)
- Managed OAuthでClaudeやChatGPTが繋がらなければ、自前のOAuth(workers-oauth-provider、Passkey、リカバリーコード)に差し替える

## 8. Web UI

AIで読み取る場所ではなく、カレンダーで振り返りながら、写真とメモを足す場所。AI機能は持たない。以下は仕様の意図と、現状の実装(「暫定」は仕様との差。詳細は第13節)。

- **ホーム**(`/`): 今日と今月の合計を主役にし、すぐ横に大分類別の金額と全体に対する割合、メモ付き支出の割合を置く。要確認の件数と最近の取引から、その日を開ける。暫定: 「今月」は月初から今日まで
- **月カレンダー**(`/calendar`): 日ごとの支出合計、メモの色、写真の有無。実装済みの追加: 月ジャンプ(年月ピッカー)、国民の祝日の表示、PC幅(900px以上)では左に月・右に選んだ日の詳細の2ペイン
- **日の詳細**(`/day/:date`): 取引一覧、メモ、写真、リンク。取引の追加、メモ(出来事)の追加・編集、写真の追加・拡大・複数削除、リンクの追加・削除。取引の行をタップすると明細ページへ。暫定: 「支出を追加」フォームに明細エディタは付けず、登録後に明細ページで入力する
- **明細**(`/tx/:id`): 1件の取引を見る画面(見るだけ)。「編集」ボタンで同じページが編集モードになり、取引の項目(日付を含む)と明細(品名・金額・行ごとのカテゴリと税金フラグ・メモ)を直す。写真・リンクも表示する。削除では、写真がついていれば写真もいっしょに消すか確認する
- **カテゴリ**(`/categories`): 大分類の下のサブカテゴリの追加・名前の変更・大分類の移動・削除、大分類の改名。ナビはPC幅の左メニュー、スマホはホームの見出しのボタンから開く
- **写真追加**(`/photos/add`): AIが作るリンク(`create_photo_upload_link`)の宛先。date、transaction_id、event_id のどれかを指定して写真を選ぶ。日の詳細の「写真を追加」と同じアップロード部品を使う
- **エクスポート**(`/backup`、ナビの文言は「エクスポート」): JSONLのダウンロード、JSONL・JSON配列の読み込みと結果表示。暫定: Markdownは「準備中」
- **期間メモ**: カレンダー上に帯で描き、重なる場合は段を分ける
- **リンク**: 日付・取引・出来事に、Xの投稿・YouTubeの動画のURLを付けられる。カードのタップで新しいタブを開き、埋め込みやサムネイルは出さない
- **税額**(`/tax`): レシートに印字された消費税額を、期間(今月・先月・今年・期間指定)ごとに税率別(切り替えで月別)の表で出す。税の内訳の無い支出の件数・金額を注記する。明細ページでは、明細の行に税率を添え、税の内訳を表で出し、編集モードで入力する
- **税金フラグ**: 取引と明細の行に、医療費控除・セルフメディケーション税制・寄附金控除のフラグを1つ付けられる(取引の追加・編集のフォーム、明細ページ)。年ごとの集計はMCPの `summarize`(`group_by: "tax_flag"`)で行い、画面には集計を出さない
- 写真は、ブラウザ側で長辺1600px程度に縮小してからアップロードする。配信は認証を通したWorker経由で、R2は公開しない
- 簡易集計は `summarize` と同じ関数を使う。凝った分析はUIに作り込まない
- 暫定: UIは Vite + Preact のSPA(第13節「フェーズ5(UI)」)。スマホは下のタブ(ホーム / カレンダー / 今日)、PCは左のメニュー(ホーム / カレンダー / カテゴリ / 税額 / エクスポート)

## 9. エクスポートとインポート

優先順位は JSONL > Markdown > HTML。

- **JSONL(+写真)**: 完全バックアップ。1行1レコードで、`type`(transaction / item / event / attachment / link / screen / seat_record)で区別する。写真は photos フォルダに入れ、JSONLと一緒にzipにする
- **Markdown**: 月、年、期間メモの期間から範囲を選ぶ。サマリ、カテゴリ内訳(表とMermaidの円グラフ)、カレンダー、期間メモ、日別明細。メモの色は🟥🟧🟩🟦🟪で再現し、写真は相対リンクにする
- **HTML**: MarkdownをHTMLに変換してCSSを当てた1ファイルだけ。見た目の再現にはこだわらない
- **インポート**: JSONL(とJSON配列)を受け付け、行ごとに結果(成功、重複スキップ、エラー理由)を返す。add_transactions は全件成功か全件失敗、インポートは行単位の部分成功を許す
- Markdownは書き出しのみ

JSONLの例:

```json
{"type":"transaction","id":"01J...","date":"2026-10-11","amount":1280,"merchant":"A店","source":"receipt"}
{"type":"event","id":"01J...","start_date":"2026-10-03","end_date":"2026-10-05","title":"出張","color":"blue"}
```

## 10. ライセンスと公開方針

- ライセンスは GNU Affero General Public License v3.0(AGPL-3.0)。`LICENSE` はGitHubの作成画面で入る
- 外部からのプルリクエストは受けない(GitHubの設定で、PRの作成をコラボレーターだけに制限する。PR自体を無効化すると、自分のPRでCI/CDを回せなくなる)。READMEにも書く。Issueは受ける
- 脆弱性は、private vulnerability reportingで受ける。`SECURITY.md` に書く
- `.gitignore`(Nodeテンプレートに追記)

```
.dev.vars*
!.dev.vars.example
.wrangler/
.astro/
exports/
photos/
backup/
```

- `wrangler.toml` には、アカウントID、D1のID、ドメイン、許可メールを直接書かない
- READMEの冒頭は、本質の一文(日々の支出を中心に、出来事や思い出も一緒に記録できるライフログアプリ)。MCPは入力方法の1つとして後ろで説明する

## 11. 開発フェーズと完了条件

1. **準備**: 上記の構成、README、SECURITY.md、CLAUDE.md、`.dev.vars.example`、`npm run check` が通る空の土台
2. **最小のMCP**: add_transactions と list_transactions、最小のD1スキーマ、認証ミドルウェア(JWT検証、フェイルクローズ、ローカルの差し替え)。ローカルで全テストが通り、ステージングにデプロイできる状態まで。実機の接続検証は人間が行う
3. **核とMCPの一式**: 5テーブル、残りのツール、JSONLのインポートとエクスポート
4. **認証の仕上げ**: JWT検証のテスト一式、ステージングのE2E
5. **Web UI**: ホーム、月カレンダー、日の詳細、写真アップロード、期間メモ
6. **エクスポートの追加**: Markdown。必要ならHTML

## 12. 人間が行う作業(エージェントは手順を docs/setup.md に書く)

1. GitHubのリポジトリ作成(Public、AGPL-3.0、Node)、PR作成のコラボレーター限定、mainのルールセット作成、private vulnerability reportingの有効化
2. `wrangler login`、D1とR2の作成(ステージングと本番)、シークレットの設定
3. Accessのアプリ作成(ステージングはService Authのポリシー)、Managed OAuthの有効化、DCRの許可リストにClaudeとChatGPTのコールバックURLを登録
4. Claude.aiとChatGPTからのコネクタ接続の検証
5. 使うドメインとサブドメインの決定
6. 本番へのデプロイ(CIが行う。マージ前に承認者を設定する。`docs/ci-cd.md`)

## 13. 未決事項

- [ ] ClaudeとChatGPTのコネクタが、Managed OAuthで繋がるか(ChatGPTのプランによる制約を含む)
- [ ] ブラウザのログイン方式(ワンタイムPIN、またはPasskey対応の外部IdP)
- [ ] 使うドメインとサブドメイン
- [ ] UIはAstroか、素のViteのSPAか
- [ ] queryツール(読み取り専用SQL)を入れるか
- [ ] 以前の家計簿アプリからデータを移すか
- [ ] 金額のマイナス(返金)の扱い
- [ ] HTMLエクスポートを作るか

### 暫定の判断(エージェントが追記)

- CI/CD: PRでテスト+ステージング、mainで本番へ自動デプロイ(ユーザー指示)。仕様の「デプロイは人間」はエージェントが手元で実行しない、の意味に読み替えた
- `npm run check` は当初 tsc → eslint → vitest。UIが入ったあとは tsc → eslint → vitest → build(`npm run build`)
- フェーズ2(取引): 金額は1〜10,000,000円の整数(返金・マイナスは当面不可)。`source` は省略すると `manual`。店名かカテゴリが空なら `needs_review`
- フェーズ2(重複): 重複は全体のエラーにせず、その取引だけを登録せずスキップして `skipped_duplicates` で既存IDを返す(残りは登録する)。同じ配列内の重複は、後のものをスキップする。「全件成功か全件ロールバック」は、検証エラーとDB書き込みに適用する
- フェーズ2(カテゴリ・口座): 初期データは migration で投入(カテゴリ: 食費、日用品、交通・チャージ、娯楽、その他。口座: 現金、カード、Suica)。未知の名前はエラーにして、選べる値を示す。`group_name` は暫定(食費/生活/交通/娯楽/その他)
- フェーズ2(MCPの入力エラー): MCPの入力スキーマ違反は、SDKが返すZodの検証メッセージ(日本語)をそのまま使う。ドメイン上のエラーは `{ok:false, errors:[{index,field,message}]}`
- フェーズ2(認証): `/healthz` も含め全ルートを認証の内側に置く。未認証・設定不足はどれも401(理由は返さず、ログにだけ出す)。JWTの署名アルゴリズムは RS256 のみ
- テスト基盤: `@cloudflare/vitest-pool-workers` は非推奨(`@cloudflare/vitest-plugin` に改名)なので後者を使う。vitest 4 系。npmの依存解決エラー回避のため `.npmrc` に `legacy-peer-deps=true`
- D1の `database_id` は wrangler.toml に書かない。デプロイ時の自動プロビジョニングに任せる想定(未確認。docs/setup.md)
- フェーズ3(出来事): `update_event` は、更新する項目が1つも無い呼び出しをエラーにする。`start_date` だけを後ろにずらして既存の `end_date` より後になる場合もエラー(期間解除は `end_date: null` を同時に指定)。`end_date` が `start_date` と同じ日でもそのまま保存する。日付は形式と実在日だけを検証し、未来の日付も許可する(予定にも使うため)。`list_events` は指定期間と重なる出来事を、開始日の昇順で返す。`delete_event` は仕様にないので作っていない
- フェーズ3(取引の修正・削除): `update_transaction` は、date / amount / source を null で空にできない。id だけの更新はエラー。更新のたびに dedup_hash と status(店名とカテゴリが両方あれば ok)を再計算し、他の取引と重複する場合は更新を止めず `warnings` で知らせる。空文字の店名・カテゴリはエラー(null で空にする)。`delete_transaction` は、写真(attachments)が紐づく取引を拒否する(写真の機能はフェーズ5)
- フェーズ3(集計): `summarize` の期間省略は全期間。`percent` は小数第1位。`event_id` 集計は、1つの取引が複数の出来事に入る場合それぞれに数える(行の合計が全体を超えうる)。どの出来事にも入らない取引は「(出来事なし)」、カテゴリなしは「(未分類)」、店名なしは「(店名なし)」。rows の件数に上限は設けていない。`list_categories` は、カテゴリ(name と group_name)と口座名を返す
- フェーズ3(エクスポート・インポート): JSONL のみ(写真のzipはフェーズ5、Markdownはフェーズ6)。`GET /export` はカテゴリと口座を名前で出す。`POST /import` は、JSONL または JSON 配列(先頭が `[`)を受け付け、行ごとに結果(ok / skipped_duplicate / skipped_exists / error)を返す。上限は 5MB または 5000 行(件)で、超えると 413、空は 400。取引の行が `id` と `created_at` の両方を持つ場合は、エクスポート由来のバックアップ行とみなして重複判定を飛ばす(allow_duplicate で登録した取引も復元で消えない)。どちらかが無い行は、従来どおり重複判定をする。エクスポートはページごとに読むため、読み出し中に書き換わると、テーブル間の整合は取れない
- 運用: 並列作業の各ブランチ(`cc/phase3-...`)は、ユーザーの指示(並列で進めてよい)に基づいて作った
- フェーズ5(UI): 「UIはAstroか素のViteのSPAか」は **Vite + Preact のSPA** にする(画面はすべてAPIから読み込む動的なもので、Astroの強みが活きにくい。Astroの公式ドキュメントが、現在の環境から読めない)。第3節の表の「UI」の行を読み替える。ルーターは自前(3ページだけ)。配信は Workers Assets(`run_worker_first = true` で、静的ファイルも認証を通す。`not_found_handling = "single-page-application"`)。Cloudflareのビルドコマンドは `npm run build`
- フェーズ5(API): Web UI 用のAPIは `/api/*`。契約は `docs/api.md` と `src/api/contract.ts`。写真はR2に保存し(公開しない)、Worker経由で認証つきで配信する。受け付けるのはJPEG/PNG/WebPで、先頭のバイト列で判定し、5MBまで

- フェーズ5(API・集計): 未定義の `/api/*` は404のJSON。id が存在しないエラーは、core のエラー文言(`field==="id"` と「〜はありません」)で404に変換する(文言に依存する)。ホームの集計は、メモ付き支出の割合が今月の取引、要確認の件数と最近の取引10件(PC・スマホとも一覧表示。PC幅では内訳の下に横幅いっぱいで出す。並びは購入日ではなく登録した順(created_at の新しい順)。同時刻は id 順)が全期間。カレンダーの写真枚数と日詳細の写真は、日付そのもの・その日の取引・その日と重なる出来事のどれかに紐づく写真を、重複なく数える。`GET /api/categories` は `categories` と `accounts` だけ返す。PATCH のパスの id が本文の id に優先する
- フェーズ5(写真): アップロードは Content-Length 必須(無ければ411)、5MB超は413(Content-Length、`file.size`、coreの3段階で検査。ちょうど5MBは通す)。空欄のフォーム項目は未指定。紐づけ先が無ければ400、取引・出来事が無ければR2に書く前に400。保存に失敗したらR2のオブジェクトを消して500。削除はR2が先、行が後(失敗しても再実行で消える)。配信は保存時に検証したContent-Type(許可した3種以外は404)、`nosniff`、`Content-Security-Policy: default-src 'none'; sandbox`、`Cross-Origin-Resource-Policy: same-origin`、`Cache-Control: private, max-age=31536000, immutable`。WebPの判定は `RIFF`…`WEBP` の目印だけで、厳密にはしない(nosniffとsandboxで無害なため)。孤立したR2オブジェクトの掃除は未実装
- フェーズ5(CSRF・JSON): 書き込み系(POST/PATCH/PUT/DELETE。`/api/*` と `/import`)は、Origin があれば同一オリジンか検査し(違えば403)、無ければ Sec-Fetch-Site が same-origin / none 以外を403にする。どちらも無い非ブラウザは通す。`/mcp` は Bearer 認証でOriginが付かないので対象外。JSONを受ける取引・出来事のルートは `application/json` 以外を415。JSONのAPI応答は `Cache-Control: private, no-store`
- フェーズ5(ホーム・日詳細): 「要確認」のタップ先は、直近の記録に要確認があればその日、無ければ当月のカレンダー(絞り込み画面は未実装)。メモ付き割合は件数から計算し直す。日詳細のメモ欄の内容は出来事の `title` に保存し、`note` は画面では編集しない。終了日が空か開始日と同じなら1日の出来事。写真は日付だけを付けて送る。手入力の支出は `source: "manual"`、`allow_duplicate: true`
- フェーズ5(PWA): アプリの静的ファイル(`/assets/`、`/icons/`)だけをService Workerでキャッシュし、HTML・API・写真・`/mcp`・`/export`・`/import`・`/healthz` はキャッシュしない(認証つきの内容を共有キャッシュに入れないため。オフラインでは画面が開けない)。キャッシュ名はバージョンつきで、更新時に古いものを消す。アイコンは依存なしのNodeスクリプト(`ui/scripts/gen-icons.mjs`)で生成。manifest は `crossorigin="use-credentials"`
- フェーズ5(税金のフラグ): 取引に `tax_flag`(`medical`=医療費控除 / `self_medication`=セルフメディケーション税制 / `donation`=寄附金控除。1取引に1つ、なしは NULL)を足した(migration 0004、インデックスは `(tax_flag, date)`)。金額の記録と年ごとの集計だけで、控除の対象かどうか・控除額・上限の案内はしない。`dedup_hash` には含めない。`list_transactions` は `tax_flag` で絞り込め、`"any"` で何かのフラグ付き全部。`summarize` は `group_by: "tax_flag"`(行名はラベル、フラグなしは「(フラグなし)」で、割合の分母はフラグなしを含む期間内の全取引)。`add_transactions` は省略または null がフラグなし、`update_transaction` は null で解除。JSONL の取引の行に `tax_flag` を出し、無い古いバックアップも取り込める。ラベルは `src/core/tax-flags.ts` が正で、UI(`ui/src/taxFlags.ts`)に同じ文言を持つ(テストで一致を確認)。薬局のレシートに medical と self_medication のどちらを付けるかは利用者が決める(AIは迷ったら聞く)。併用や上限のような制度上の判断はしない
- フェーズ5(AIから写真): MCPツールに `create_photo_upload_link` / `list_photos` / `get_photos` を追加(12個)。AIは画像の中身を渡せない前提で、登録は「リンクを返す→利用者が開いて選ぶ」方式。リンクは `<オリジン>/photos/add?date=..&transaction_id=..&event_id=..&caption=..`(オリジンはリクエストから取り、ドメインは書かない)。有効期限やトークンは付けない(画面はAccessの内側で、開いた人の認証で守られるため)。`/photos/add` は date 必須(不正なら日本語のエラー画面)、transaction_id と event_id は両方付いてもよく、caption はその回の全写真に付く。`list_photos` は date / transaction_id / event_id の和集合(重複なし)で、存在しない参照はエラー。`get_photos` は1回4枚まで、元バイト数の合計が約6MBを超える分は返さず理由を書く。存在しないidがあっても取れた画像は返し isError にする
- フェーズ5(写真の複数操作): 複数アップロードは1回20枚まで、縮小と送信は同時2件、一部失敗しても続行し最後に「N枚追加、M枚失敗」と理由を出す。複数削除は個別DELETEを同時2件で呼ぶ(一括削除APIは作らない)。失敗した写真は選択状態のまま残す。アップロード開始時は選択モードを抜ける。許可形式と上限はサーバーと同じ値をクライアントにも持つ
- フェーズ5(リンク): 出来事・取引・日付に、Xの投稿とYouTubeの動画のリンクを付けられる(テーブル `links`、migration 0003)。許可ホストは x.com / twitter.com(www・mobile含む)と youtube.com(www・m・music)/ youtu.be の https のみ。偽装ホスト・userinfo・ポート・非ASCIIは拒否。URLは正規化して保存(追跡用クエリを削除、YouTubeは v / t / list だけ残す。x.com と twitter.com は寄せない)。同じ紐づけ先に同じ正規化URLがあれば登録せず既存を返す(`duplicate: true`)。タイトルは任意で、外部サイトへは取りに行かない。埋め込み・サムネイルも出さず、カードのタップで新しいタブを開く(`https` 以外はリンクにしない)。更新できるのはタイトルだけ。取引・出来事を削除すると、紐づくリンクもいっしょに消える(写真が紐づく場合は従来どおり削除を断る)。MCPは `add_link` / `list_links` / `delete_link`(15個)。JSONLは `link` 行で、取り込み時にURLを検証・正規化し、同じidは skipped_exists、別idで同じ紐づけ先とURLは skipped_duplicate
- フェーズ5(デザイン合わせ): ホームの内訳バーの色は主色の濃淡・砂色・灰(出来事の色と混ぜない)。「今月」の期間は月初から今日まで。PC幅(900px以上)のサイドバーは「ホーム / カレンダー / エクスポート」で、「今日」はホームの緑ボタンで代替する。ホームに「今月の出来事」は出さない(`HomeData` に無い)。カレンダーのPC幅は、左に月・右に選んだ日の詳細(読み取り専用。編集は日の詳細ページ)の2ペイン。日セルの金額は「¥」なし、月の合計だけ「¥」つき。日の詳細は、大分類とカテゴリを1つのチップにし、口座はテキスト。メモ(出来事)の追加・編集は、デザイン案の単一テキストエリアではなく出来事のフォーム(期間・複数・色名つき)にする(意図的な差)。年月ピッカーは別画面でなくシート型(月ごとの金額は年単位の集計APIが無いため出さない。年の範囲は2000〜2099)
- フェーズ5(エクスポート画面): 画面は `/backup`(ナビの文言は「エクスポート」)。読み込みの前にブラウザで上限(5MB・5000行。空行を除く行数かJSON配列の件数)を検査し、中身の判定はサーバーに任せる。結果は登録 / 重複でスキップ / 既にある / 読めなかった行(最大50件)に分けて出す。期間指定と件数表示は、`/export` が対応していないので出さない。Markdownは「準備中」(フェーズ6)。バックアップに写真の実体は含まれない
- フェーズ5(祝日): 国民の祝日は外部APIを使わず `ui/src/holidays.ts` で計算する(2000〜2099年)。春分・秋分は近似式、ハッピーマンデー、振替休日、国民の休日、2019年の即位に関する休日、2020・2021年の東京オリンピックによる移動に対応。振替休日は2007年以降の規則を2000〜2006年にも適用する(簡易化)。祝日は出来事としては保存せず、表示だけにする
- フェーズ5(障害対応): 想定外の例外は、ログに種類と文面(200文字まで。値は出さない)を残し、`/api/*` にはJSONの500で理由を返す。本番で「新しい列が無い」エラーが出た原因は、Cloudflareの「デプロイコマンド」が `npx wrangler deploy` だけでマイグレーションが当たっていなかったこと。デプロイコマンドは必ず `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy --env=""` にする(docs/setup.md)
- フェーズ5(明細): 「1レシート=1支出=カテゴリ1つ」をやめ、レシートの下に明細(行)を持てるようにした(ユーザー指示)。第5節の「明細行は持たず、合計額だけ」を置き換える。以下、項目ごと
  - データ: テーブル `transaction_items`(migration 0005、追加のみ。外部キーは取引・カテゴリ。索引は `(transaction_id, position)`)。既存の取引は明細なしのままで、バックフィルしない。集計の土台は SQL の VIEW ではなく、core の共通クエリ片(`src/core/items.ts` の `spendLines`)にした(VIEW はマイグレーションでしか変えられず、後の変更が重いため)
  - ルール: 取引の `amount` が支払総額の正。明細がある取引は「明細の amount の合計 = 取引の amount」が必須で、合わなければ全体を拒否し、差額を日本語で返す(「明細の合計(580円)が金額 amount(1,000円)と一致しません。差額は420円で、明細が420円足りません…」)。明細は任意で、1取引50行まで。行の金額はマイナス(値引き)可、0は不可、絶対値は10,000,000以下。品名は100文字まで。取引の金額は従来どおり1円以上(返金は未対応のまま)。`position` は入力の配列の順(0始まり)に振り直す
  - 実効値: 行の実効カテゴリ・実効フラグは COALESCE(行の値, 取引の値)。「全部同じカテゴリ」は取引のカテゴリだけを付け、行のカテゴリを空にして表す。`ItemView` の `category` / `tax_flag` は行自身の値(実効ではない)
  - 集計: 「支出の行」(明細がある取引は各明細行、無い取引は取引そのもの)を土台に、`summarize`(全 group_by)、ホームの大分類別の内訳、税金フラグ別の集計、`list_transactions` の `tax_flag` 絞り込み(行のどれかが当てはまれば含める。`"any"` も同様)を数える。`category` の絞り込みも同じく行のどれかで含める(仕様外の判断)。**summarize の rows の `count` は支出の行の数**(取引数ではない)。戻りの `count` は従来どおり取引(レシート)の件数で、行の数は新しい `lines` に入れた。`total` と行の合計の総和は、取引の合計と一致する(テストで確認)。日別合計・カレンダー・ホームの今日/今月の合計と件数は、取引の amount と件数のまま
  - status: 店名が無い、または実効カテゴリの無い行が1つでもあれば `needs_review`(明細なしは従来どおり店名かカテゴリが空なら)。`dedup_hash` は変えない(日付|金額|正規化した店名。明細は含めない)
  - カテゴリの引き継ぎ: `add_transactions` で取引のカテゴリが省略され、カテゴリの無い行がある(明細なしなら取引そのものがその行)とき、同じ正規化店名(全角半角・大文字小文字・空白を吸収)の既存の取引のうち、カテゴリが付いた直近のもの(日付、登録日時の順)のカテゴリを取引のカテゴリにし、結果の各登録に `applied_default_category` を付けて message でも知らせる。明細なしの取引にも適用する(仕様の「カテゴリの無い行」を、明細なしの取引そのものも含むと読んだ)。明示したカテゴリは上書きしない。同じ呼び出しの中の他の取引は参照しない。既存の支出には遡らない。インポートには適用しない。店名の正規化はSQLでできないので、店名の表記ごとの直近を読んでから寄せる
  - 表現: `TransactionView` に `items: ItemView[]`(id, position, name, amount, category, tax_flag, memo。明細なしは空配列)を足し、`GET /api/day/:date` とホームの最近の取引、`add_transactions` / `update_transaction` / `list_transactions` の戻りに含める。`list_transactions` は `include_items`(既定 true)。`GET /api/transactions/:id` は `{transaction, photos, links, counts: {items, photos, links}}`(写真・リンクは transaction_id が一致するものだけ)
  - 追加・更新: `items` は `add_transactions` の各取引と `update_transaction`(`PATCH /api/transactions/:id`)に追加。更新は全置換で、`null` と省略は変更なし、`[]` で全部消す(`items: null` だけの更新は「変更なし」としてエラー)。金額・カテゴリなどだけの変更でも、今の明細と合計の整合を検証する(合わなければ `field: "amount"`)。取引と明細の書き込みは1回の batch
  - 削除: `delete_transaction` / `DELETE /api/transactions/:id` に `delete_photos`(API は `?delete_photos=1`。`0` と省略は false、それ以外の値は400)。既定は従来どおり写真つきの取引を断る(「写真N枚が紐づいています。delete_photos で写真もいっしょに削除できます」)。指定時は R2 の写真オブジェクトを先に消し、attachments の行・リンク・明細・取引を1回の batch で消す(途中で失敗しても再実行で消える)。写真が出来事や日付にも紐づいていても、写真ごと消す。戻りの `deleted` は `{transaction(削除前の内容), items, photos, links(消した件数)}` に変えた(以前は取引そのもの)。明細とリンクは写真が無ければ確認なしで消える
  - カテゴリ: `usage`(使用数)は取引のカテゴリと明細の行のカテゴリの件数の和。カテゴリの削除で `move_to` を指定すると、明細の行のカテゴリも付け替える
  - JSONL: 取引の行とは別に `type: "item"` の行(`id`, `transaction_id`, `position`, `name`, `amount`, `category`(名前), `tax_flag`, `memo`, `created_at`)を、取引の後に出す。取り込みは、同じファイルの取引の行(id が一致)に明細を結びつけ、取引と明細を1回の batch で書く。合計が合わない・明細のカテゴリが未知(復元では自動作成)・50行超・明細の id が既存なら、その取引と明細の行を error にする。取引が skipped_exists / skipped_duplicate なら、明細の行も同じ状態にする。取引の行が無い明細は、同じ id が既にあれば skipped_exists、無ければ error。取引の行に入れ子の `items` を書いたものは error(明細は item の行で書く)。明細の無い古いバックアップはそのまま取り込める
  - MCP: ツールは増やさず、`add_transactions` / `update_transaction` / `list_transactions` / `delete_transaction` / `summarize` の入力スキーマと説明を更新した(「レシート写真を見て、品名・金額の行をそのまま items に入れる。値引きはマイナスの行。合計は金額と一致させる」)
  - 画面: 明細の表示・編集は `/tx/:id`(下の「フェーズ5(明細の画面)」)。日の詳細の取引フォームは明細を送らないので、明細のある取引の金額だけを日の詳細から変えると、合計の検証で400になりうる(明細ページで直す)
- フェーズ5(カテゴリ管理): カテゴリ(大分類の下のサブカテゴリ)を、画面・API・MCP(`add_category` / `update_category` / `delete_category` / `rename_group`)から管理できる。MCPのツールは合計19個(第6節)。以下、項目ごと
  - 名前: カテゴリ名は30文字、大分類名は20文字まで。前後の空白はトリムする。カテゴリ名を「.」だけ(「..」など「.」だけで並んだものも)にはできない(URLの `/api/categories/:name` で編集・削除できなくなるため)。名前は完全一致で一意(NFKC正規化や大文字小文字の同一視はしない)
  - 大分類: 独立した表を持たず、同じ `group_name` のまとまり。最後のカテゴリを移す・消すと、その大分類は消える。名前・大分類を変えても、取引の `category_id` には影響しない。大分類の改名で既存の別の大分類と同名にすると統合になる(確認なし。結果に変更した件数 `updated` と統合したか `merged` を返す)
  - APIのエラー: 重複・空・変更なし・移し先(`move_to`)の誤りは400、存在しないカテゴリ・大分類は404(文言「〜という〜はありません」に依存して判定する)
  - 削除: `move_to` を付けても、使われていなければ何も移さずに削除する。使われているのに `move_to` が無ければ400。画面の削除は2段階の確認で、使用中なら移し先を選ぶ(初期値は同じ大分類の別のカテゴリ)。「大分類を追加」は、最初のサブカテゴリと同時に作る
  - バックアップの復元: 取り込み先に無いカテゴリを、大分類「その他」で自動作成する(大分類の復元は未対応)
- フェーズ5(明細の画面): 明細の表示・編集(`/tx/:id`)。以下、項目ごと
  - 遷移: 日の詳細の行のタップ先は `/tx/:id`(見るだけ)。編集は「編集」ボタンで同じページが編集モードになる。日付は編集モードで変更できる。日の一覧の「N点・ほかN」は、取引のカテゴリ以外の実効カテゴリの種類数
  - 明細エディタ: 空行(品名・金額・メモがすべて空)は送らない。明細が0行になったとき、元々明細があれば `items: []`、なければ `items` を省略する。保存の条件は、明細がなければ常に可、あれば合計一致かつ全行が有効(0円や整数でない行は不可)なときだけ。「合計に合わせる」は明細の合計が正のときだけ出す。金額欄はマイナス入力のため text 入力にしている
  - 一括設定: 同じカテゴリ・税金フラグの一括設定は、確定のたびに select を空に戻す
  - 表示: 行のカテゴリが null で取引にもカテゴリが無い場合は「カテゴリ未設定」の警告チップを出す
  - 404判定: `GET /api/transactions/:id` の404は、`field:"id"` のエラーで「はありません」を含む場合(文言に依存する)
  - 追加フォーム: 日の詳細の「支出を追加」には明細エディタを付けず、登録後に明細ページで入力する
- フェーズ5(明細の登録の方針): **レシートの印字がマスター**。品目の金額・値引き・合計は印字どおりに登録し、計算が合うように品目の金額を調整しない。品目の下にインデントや括弧で書かれた値引き・割引は、前の品目に足し引きせず、別のマイナスの行(値引き対象と同じカテゴリ)として登録する。amount は印字された支払総額のまま。明細の合計が合わないときは、品目の金額は変えずに読み直し、それでも合わなければ「端数・調整」の行(プラスまたはマイナス)で差額を合わせるか、利用者に確認する。スキーマの変更はなく、MCPツールの説明(add_transactions)とドキュメントで AI に指示する
- フェーズ5(レシートの情報): 後から店に問い合わせる(例: タクシーの領収書)ため、レシートに印字された情報を取引の任意の列(NULL可)で持てるようにした(migration 0006、追加のみ。既存の取引はNULLのまま。バックフィルしない)。以下、項目ごと
  - 列と検証(`src/core/receipt-details.ts` の Zod スキーマ1つで、add / update / API / JSONL の取り込みを兼ねる): `paid_time`(決済時刻。日本時間の `HH:MM`、00:00〜23:59。日付は既存の `date`)、`merchant_phone`(数字・ハイフン・括弧・プラス・空白のみ、30文字まで。全角は半角、ハイフン類は `-`、空白は1つにして前後を除いて保存。数字が1つも無いものは不可)、`merchant_address`(200文字まで)、`invoice_number`(適格請求書発行事業者の登録番号。全角・小文字の t・ハイフンや空白入りを許容して正規化し、正規化後に `^T\d{13}$` でなければ「T と数字13桁で入力してください」)、`clerk_name`(担当・責任者・レジなどの印字。50文字まで)、`receipt_no`(レシート番号・伝票番号。50文字まで)。空文字は不可(空にするときは null)。登録では null と省略は同じ(値なし)。`update_transaction` は null で空にでき、渡さない項目は変えない
  - `dedup_hash`: `paid_time` がある取引は `日付|金額|店名|時刻`、無ければ従来どおり `日付|金額|店名`(既存の行のハッシュは変えない)。同じ日に同じ店で同額の別の買い物(時刻が違う)を重複扱いにしないため。時刻ありと時刻なしは別のハッシュになるので、同じレシートを時刻あり・なしで二重に登録した場合は検出できない(`update_transaction` で時刻を足すと、ハッシュも再計算される)
  - 検索: `list_transactions` に `keyword`(1〜100文字)。店名・電話番号・住所・担当者名・メモ・レシート番号のどれかに部分一致する。登録番号にも当てた(登録番号で探せると問い合わせや確定申告で便利なため。依頼の列挙に足した判断)。英字の大文字小文字は区別しない。LIKE のワイルドカード `%` `_` とエスケープ文字 `\` は文字として探す(ESCAPE 句)。キーワードが電話番号らしい(数字・ハイフン・括弧・プラス・空白だけ)ときは、保存済みの電話番号から数字以外を除いた形との部分一致でも当てる(`03-0000` でも `0300000000` でも当たる)。ほかの条件(from / to / category / tax_flag)とは AND。`GET /api/day` など画面用のAPIには検索を足していない
  - 表現: `TransactionView` に6項目(なしは null)。`GET /api/transactions/:id`、`GET /api/day/:date`、ホームの最近の取引、`add_transactions` / `update_transaction` / `list_transactions` の戻り、`POST/PATCH /api/transactions` の入出力、JSONL の取引の行(エクスポートは常に6項目を出す。古いバックアップ=項目なしも取り込める)に含める
  - 日の詳細の並び: `GET /api/day/:date` の取引を、決済時刻の昇順(時刻なしは末尾、同じ時刻・時刻なしどうしは登録順)にした。それまでは登録順だけ
  - MCPの説明(add_transactions): 項目はレシートに印字されている場合だけ拾い、印字が無い項目は省略する(推測で埋めない)。電話番号・住所・時刻は特に拾う。**読み取れない・薄くて判読できない項目は、推測で埋めず、登録する前に利用者に選択肢を示して確認する**: (1) 利用者に値を教えてもらって補う、(2) 合計金額だけ登録する(明細は省略)、(3) 登録をやめる。利用者が決めるまで登録しない。部分的に読めない項目(例: 電話番号だけ薄い)は、その項目だけ省略して登録し、結果を伝えて、必要なら後で `update_transaction` で補うよう案内する
  - 画面(`/tx/:id`): 見るだけのビューは、日付の隣に「決済時刻 14:32」、「店舗の情報」のブロック(電話は `tel:` リンク、住所と登録番号は「コピー」ボタン。クリップボードが使えないときはテキストを選択状態にして、長押しなどでコピーしてもらう。対応した人、レシート番号)。5項目が全部空ならブロックごと出さない。編集モードには入力欄を追加(電話は type=tel、時刻は type=time、住所は textarea)。登録番号は入力中に注意書きを出し、欄を離れると正規化する。検証の規則はサーバーと同じ(UI は core を import しないので `ui/src/receiptDetails.ts` に持ち、`tests/ui/receipt-details.test.ts` が一致を確かめる)。日の詳細の「支出を追加」には入力欄を付けず(登録後に編集で入れる)、日の一覧の支出の行には、時刻があれば店名の横に小さく「14:32」を出す。PC幅の簡易表示(DayPane)は変えていない
- フェーズ5(カテゴリのアイコン): カテゴリにアイコンを付けられる(ユーザー指示。Zaim のカテゴリアイコンのように、文字より分かりやすくする)。以下、項目ごと
  - データ: `categories.icon`(TEXT、NULL可。migration 0007、追加のみ)。初期の5カテゴリは名前が一致する行だけ既定のアイコン(食費=food、日用品=daily、交通・チャージ=transit、娯楽=entertainment、その他=other)を付け、名前を変えた行は触らず NULL のまま
  - キー: 英小文字の31個(食事・カフェ・食料品・日用品・電車/バス・タクシー・クルマ・ガソリン・交際・娯楽/音楽・映画・教育・本・服・美容・医療・保険・通信・水道/光熱・住まい・税金・大型出費・旅行・贈り物・子ども・ペット・スポーツ・趣味・サブスク・金融・その他)。正は `src/core/category-icons.ts` の `CATEGORY_ICONS`(Zodのスキーマ1つで検証。一覧にない値は選べるキーを日本語で返してエラー)。UI(`ui/src/categoryIcons.ts`)に同じ一覧を持ち、テストで一致を確かめる。キーを足すときは core・UI・絵(`ui/src/categoryIconPaths.ts`)・contract の型・MCPの説明(自動)をそろえる
  - 入出力: `add_category` / `update_category`(MCP)と `POST` / `PATCH /api/categories` に `icon`。省略は新規なら NULL、更新なら変えない。更新は null で外せる。今と同じアイコンだけの更新は「変更なし」のエラー。`list_categories` と `GET /api/categories` の各カテゴリに `icon`(NULL可)。MCP の説明に「キー=意味」の一覧を載せ、AI が名前に合うアイコンを選んで付ける。JSONL はカテゴリを名前で出すのでアイコンは含めず、復元で自動作成されるカテゴリは NULL
  - 画面: 絵は自作の線画(24px、`currentColor`、`aria-hidden`)。NULL・未知のキーは「その他」(・・・)。`/categories` は行の先頭に36pxの丸のアイコンと、追加・編集フォームのアイコン選択(5列のボタン、`aria-pressed`、選んだものをもう一度押すと外れる)。支出の行・明細・ホームの最近の記録のカテゴリには、16pxのアイコンを文字の前に付ける(文字は残す)。カテゴリの select の option にはアイコンを付けない。ホームの大分類別の内訳は色の丸のまま。アイコンは `GET /api/categories` の結果(名前→icon)から引く。一覧を読めない・一覧にないカテゴリ名のときは文字だけで表示する(Home は自分で1回読み込む)
- フェーズ5(口座の管理): 口座(支払方法。`accounts`)を、カテゴリと同じ作りで MCP と Web UI から追加・名前変更・削除できる(ユーザー指示)。以下、項目ごと
  - ツール: `add_account` / `update_account`(名前変更) / `delete_account`(MCP。ツールは19個から22個に)。API は `POST /api/accounts`、`PATCH /api/accounts/:name`、`DELETE /api/accounts/:name?move_to=`、一覧は `GET /api/accounts`(`{name, usage}[]`)。口座は名前で指す(カテゴリと同じ。名前の「.」だけは不可)。ロジックは `src/core/accounts.ts`、検証はZodのスキーマ1つ。`GET /api/categories` の `accounts`(`string[]`)と `list_categories` の `accounts` は変えない
  - 名前: 前後の空白を除く・空不可・30文字まで(カテゴリ名と同じ規則)・重複不可。名前の変更は、取引が口座のIDで参照しているので表示に自動で反映される(取引の更新・`status`・`dedup_hash` への影響なし)。今と同じ名前への変更はエラー
  - 削除: カテゴリの流儀に合わせる。使っている取引が無ければ削除。あるのに `move_to` が無ければ拒否(件数を返す)。`move_to` があれば、取引の口座を付け替えてから削除する(NULL にはしない)。存在しない `move_to` ・自分自身はエラー。カテゴリと違い「最後の1つは削除できない」とはしない(取引の口座は任意で、使われていなければ消しても取引に影響しないため)
  - 未知の口座名は今までどおりエラー(選べる値を示す)。自動追加はしない。AI向けの説明には「利用者に確認してから追加する」「表記ゆれ(現金とげんきん)で増やさない」「先に `list_categories` で既存を確かめる」と書いた
  - 画面: `/categories` の下に「支払方法」のカードを足した。行の見た目・編集・2段階の削除確認・移し先の選択はカテゴリと同じ(44px以上のタップ領域)。純粋な部分は `ui/src/pages/accountsLogic.ts`。使っているのに他に口座が無いときは、先に別の口座を追加するよう案内して削除をふさぐ
  - テスト基盤: 各テストの前に口座も初期データ(現金・カード・Suica)に戻す(`tests/setup.ts`)
- フェーズ5(座席の記録): 映画館などの「スクリーン・座席の記録」を、メモではなく構造化して登録でき、次に席を選ぶ参考にAIから引けるようにする(ユーザー指示)。取引の列は増やさず、別の小さな記録 `seat_records` にする。映画以外(劇場、ライブ会場など)にも使える汎用の名前(venue=会場、screen=スクリーン/ホール/エリア、seat=座席、seat_class=席種)。以下、項目ごと
  - 項目: `id`, `date`(YYYY-MM-DD・必須), `title`(任意。作品名・公演名。下の追記を参照), `venue`(必須), `screen`(任意), `seat`(必須。例「F-5」), `rating`(任意。整数1〜5、5が最良。範囲外・小数は Zod エラー), `note`(任意の一言), `transaction_id`(任意。取引への紐づけ), `created_at`。当初は作品名を持たなかったが、末尾の追記で `title` を足した。migration は `0008_seat_records.sql`(index は venue+date、date、transaction_id)
  - 上限・トリム: 前後の空白を除き、空は不可(任意項目は省略か、更新時の `null` で消す)。`venue` 100文字・`screen` 100文字・`seat` 50文字(ID・名前の流儀)、`note` 200文字(リンクの title と同じ。events のメモ1000字ほど長くしない「一言」)
  - 取引との関係: `transaction_id` は `REFERENCES transactions(id) ON DELETE SET NULL`。取引を削除しても座席の記録は残り、紐づけだけ外れる(リンク・写真のように連れて消さない。席の評価は取引と独立した財産のため)。座席の記録の削除で取引は消えない。存在しない取引の指定は 400
  - ツール(MCP。ツールは22個から26個に): `add_seat_record` / `list_seat_records` / `update_seat_record` / `delete_seat_record`。説明文に「登録前に `list_venues` で既存の会場・スクリーンを確認して、同じ名前を使う。新しい名前を作る前にユーザーに確認する」(当初は `list_seat_records` で確認する書き方だったが、会場とスクリーンを別レコードに分けたときに改めた)「ユーザーが言った席が評価されていたか(rating・note)を、次の席選びの参考として要約して伝える」と書いた
  - 一覧: 絞り込み(すべて AND)は `venue` / `screen` / `seat`(完全一致。あいまい検索はしない。表記は登録時にそろえる運用)、`min_rating` / `max_rating`(評価なしは除かれる)、`from` / `to`、`transaction_id`。並びは `date` の新しい順(同じ日は登録の新しい順)。`limit` は既定100・最大500。結果は `count`(絞り込みに合う全件の数)、`records`、`summary`(venue・screen・seat ごとの `count` / `rated_count` / `avg_rating`。平均は小数1桁、評価がなければ null。`limit` に関わらず全件で集計。最大200行)、`truncated`
  - API: `GET /api/seat-records`(クエリは `date`=その日だけ、`venue`、`screen`、`seat`、`min_rating`、`max_rating`、`from`、`to`、`transaction_id`、`limit`)、`POST /api/seat-records`、`PATCH /api/seat-records/:id`、`DELETE /api/seat-records/:id`。既存ガード(同一オリジン、JSON必須、長すぎる id は404)に乗せた。`GET /api/day/:date` に `seat_records`(その日の分、登録順)を足した(契約 `src/api/contract.ts` と型を更新)
  - 画面: 日の詳細(`/day/:date`)に「座席の記録」のカード(一覧、追加・編集・削除のフォーム)。会場名とスクリーン名は `<datalist>` で既存の名前の候補から選べて、入力もできる(候補は当初 `GET /api/seat-records?limit=1` の `summary` から作っていたが、会場とスクリーンを別レコードに分けたあとは `GET /api/venues` から作る。末尾の追記を参照)。評価は「★1〜★5」の文字入りのボタン(`aria-pressed`、もう一度押すと外れる。色だけに頼らない)、タップ領域は44px以上。一覧の評価は「★4」(未評価は「評価なし」)。PC幅の詳細ペイン(DayPane)にも読み取り専用で出す。純粋な部分は `ui/src/pages/seatRecordLogic.ts`
  - バックアップ: JSONL に `type: "seat_record"` を足した(エクスポートは link の後。インポートは取引の後に取り込む)。既存の type と形式は変えない。取り込みは行ごとに検証し、同じ `id` は `skipped_exists`、存在しない `transaction_id` はその行だけエラー(リンクと同じ流儀)。`docs/backup.md` に追記
  - テスト基盤: 各テストの前に `seat_records` も空にする(`tests/setup.ts`)
  - 作品名を追加した。直前の「作品名は持たない」を改める(ユーザー指示: 「明細は明細。映画・映画館の情報は映画館情報。作品名を明細として終わらせたくない」。映画だけでなくライブなど他の催しの名前も入れられるようにする)。以下、項目ごと
  - 項目: `title`(任意。作品名・公演名。映画のタイトル、ライブ名など)。会場・スクリーン・座席とは別に、そのときの催しの名前を入れる。取引の明細の品名とは別物で、紐づけも連動もしない。migration は `0009_seat_record_title.sql`(`ALTER TABLE seat_records ADD COLUMN title TEXT`。追加のみ。既存の行は NULL のまま、バックフィルしない)
  - 上限・トリム: 100文字(`venue` と同じ)。前後の空白を除き、空文字(空白だけを含む)は未指定として扱う(追加と取り込みは NULL。更新は消去)。更新は `note` などと同じく、省略すると変えず、`null` でも消せる(空文字でも消える。他の任意項目は空文字がエラーだが、画面のフォームの都合で `title` は許す)
  - 一覧: 絞り込みに `title`(部分一致。大文字小文字は SQLite の LIKE の既定。`%` `_` `\` は文字として扱い、キーワード検索の `escapeLike` を使う)を足した。他の絞り込みは完全一致のまま。`records` の各行に `title` が入る。`summary`(venue・screen・seat ごとの集計)の形は変えない。MCP のツール数は26のまま、ツール名も変えない(add / update / list の入力と説明文だけ更新)
  - API: `POST` / `PATCH` / `GET`(`title` クエリ)/ `GET /api/day/:date` の `seat_records` に反映。契約 `src/api/contract.ts` と UI の型を更新
  - 画面: 日の詳細のフォームに「作品名・公演名(任意)」を会場名の前に足した(100文字)。一覧の行は、作品名があれば太めの1行目に出し、会場・スクリーン、座席・★評価、一言を続ける。作品名がなければ従来どおり会場から。PC幅の DayPane の一覧も同じ表示(`SeatRecordLine` を共通で使う)。読み上げの説明は作品名を先頭に付ける(→ 会場・スクリーンを別の行にする形に、末尾の追記で改めた)
  - バックアップ: `seat_record` の行に `title` を含める(列は `date` の次)。`title` の無い旧形式の行もインポートできる(後方互換。`title` は NULL)。空文字の `title` は未設定、101文字以上はその行だけエラー
- 会場とスクリーンを別のレコードに分けた(ユーザー指示: 「シアター名とスクリーン名は別データすぎる。レコードを分けよう」)。理由: 表記ゆれ防止と、スクリーンごとの情報(note)を持つため。venue / screen は名前で受ける後方互換。以下、項目ごと
  - テーブル: `venues`(id, name UNIQUE, created_at)、`screens`(id, venue_id, name, note, created_at。(venue_id, name) UNIQUE)。`seat_records` は `venue_id`(NOT NULL)と `screen_id`(NULL可)を持つ。migration は `0010_venues_screens.sql`。新テーブルを作って移し、旧 `seat_records` を DROP して RENAME する(SQLite/D1 は列の削除・付け替えが面倒なため)。`seat_records` を参照するテーブルは無いので外部キーに触れない。評価・日付の CHECK、`transaction_id` の `ON DELETE SET NULL`、`title` は引き継ぎ、index は venue_id+date、screen_id、date、transaction_id
  - バックフィル(既存データを失わない): 会場名(前後の空白を除いたもの)ごとに venues を1件(重複は1件にまとめる)、(会場, スクリーン名)ごとに screens を1件(note は NULL)作り、`seat_records` の各行を名前で引き当てて id を入れる。screen が NULL・空白だけの行は `screen_id = NULL`。id は SQL 内で `lower(hex(randomblob(16)))`(アプリの UUID とは形が違うが、不透明な文字列として扱う)。検証は `tests/core/migration-venues.test.ts`(0009 の形のテーブルに旧データを入れてから 0010 を当て、行数・列・名前での引き当て・制約・index を確かめる)
  - find-or-create: 会場・スクリーンは名前の完全一致(前後の空白は除く。大文字小文字・全角半角は区別する=あいまい一致はしない)で探し、無ければ作る(`src/core/venues.ts`)。`add_seat_record` / `update_seat_record` の `venue` / `screen` は従来どおり名前で受け(入力は後方互換)、応答に `created_venue` / `created_screen`(新規に作ったか)を足し、message にも「会場『X』を新規に作りました(既存の表記と違うなら…)」と書く。AIが表記ゆれに気づくため。MCPの説明文に「登録前に `list_venues` で既存の会場・スクリーンを確認し、同じ名前を使う。新しい名前を作る前にユーザーに確認する」と書いた
  - 更新: `update_seat_record` で `venue` だけ変えて `screen` を省略したときは、同じスクリーン名を新しい会場の下で探す(無ければ作る)。移して記録がなくなった会場・スクリーンは自動で片づく(スクリーンは note が無いものだけ。会場はスクリーンも記録も無いもの)。名前だけの残骸が、候補や `list_venues` に残らないようにするため。座席の記録を削除したときも同じ。削除のツール・APIは作らない
  - ツール(MCP。ツールは26個から29個に): `list_venues`(引数なし。会場ごとに `record_count` / `rated_count` / `avg_rating` と、`screens`(`id` / `name` / `note` / 件数 / 平均評価)。席選びの参考)、`update_venue`(`id` と `name`。同じ名前の会場があるとエラー=統合はしない)、`update_screen`(`id` と `name` / `note`。`note` は null か空文字で消去。同じ会場に同じ名前があるとエラー)。`note` は200文字まで。既存4ツールの入力は変えない。`list_seat_records` の絞り込み(`venue` / `screen` は名前の完全一致)と `summary` は名前のまま動く(内部は JOIN)。結果の各 record は `venue`・`screen`(名前)に加えて `venue_id`・`screen_id`・`screen_note` を持つ
  - API: 既存の `/api/seat-records` の入出力は後方互換(`venue` / `screen` は名前。応答の `SeatRecordView` に `venue_id` / `screen_id` / `screen_note`、POST/PATCH の応答に `created_venue` / `created_screen` が増えただけ)。`GET /api/venues`(会場+スクリーン+件数・平均評価)、`PATCH /api/venues/:id`(`name`)、`PATCH /api/screens/:id`(`name` / `note`)を足した。既存ガード(同一オリジン、JSON必須、長すぎる id は404)に乗せた。`GET /api/day/:date` の `seat_records` は従来の形に上の3項目が増えただけ
  - 画面: 一覧の行を、1行目=作品名(太字・あれば)、2行目=会場名、3行目=スクリーン名(あれば。スクリーンの note があれば小さく添える)、4行目=座席と評価、5行目=一言、に分けた(PCの詳細ペインも同じ部品)。作品名がないときは会場名を太字にする。フォームの会場名・スクリーン名の候補は `GET /api/venues` から作り、スクリーンは選んだ会場のものだけに絞る(登録のない新しい会場名なら候補なし)。会場・スクリーンの名前変更と note の編集は、画面には作らない(MCP と API のみ)
  - バックアップ(JSONL): 既存の `type: "seat_record"` は形式を変えない(`venue` / `screen` を名前で持つ。旧いバックアップがそのまま読める)。インポートは名前から venues / screens を find-or-create する。`screen` の note が失われないよう `type: "screen"`(`id`, `venue`=会場名, `name`, `note`, `created_at`)の行を足した。エクスポートは seat_record の直前、インポートも seat_record より前に取り込む(ファイル内の順に関係なく)。同じ id、または同じ(会場, 名前)の screen は `skipped_exists`(既存の note は変えない)。記録もスクリーンも無い会場は書き出されない(往復で作られない)。会場の id・作成日時は書き出さないので、往復で変わってよい
  - テスト基盤: 各テストの前に `screens` と `venues` も空にする(`seat_records` の後。外部キーの順、`tests/setup.ts`)
- 席種(seat_class)を追加した(ユーザー指示: プレミアムシートや、野球場の「内野指定席」「ボックスシート」「外野自由席」のような席種を記録したい。席種には値段や見やすさなどの特徴が付く。野球場などにはスクリーンが無い)。
  - 決めたこと: 席種は文字列で持つ(`seat_records.seat_class TEXT`、migration `0011_seat_record_class.sql`。追加のみ、既存行は NULL でバックフィルしない)。席種は個々の座席ではなく席の区分なので、会場ごとの席種テーブル(値段や見やすさの特徴を持たせる)は作らず、使ってみて必要になったら検討する。`screen` は映画館以外のエリア・ブロック(内野エリア、2階席ブロックなど)にも使う広い意味にした。フィールド名 `screen` と列・API・ツール名は変えない(後方互換)。画面や説明での呼び方だけ「スクリーン・エリア」(短くは「エリア」)にした
  - 項目と上限: `seat_class` は任意、前後の空白を除き、空文字は未指定(NULL)、50文字まで(`seat` と同じ)。追加・更新の入力と、一覧の返り値(各記録)に含める。更新は `null` か空文字で消去、省略すると変えない(`title` と同じ流儀)。`summary`(会場・スクリーン・座席ごとの集計)の形は変えない
  - 一覧: 絞り込みに `seat_class`(部分一致。`title` と同じく `escapeLike` で `%` `_` `\` を文字として扱う)を足した。他の絞り込みは変えない
  - メッセージ: 登録・更新・削除の確認文は、席種があれば座席の隣に添える(例「F-5(プレミアムシート)(★4)」)。席種が無ければ従来どおり
  - ツール(MCP): `add_seat_record` / `update_seat_record` / `list_seat_records` に `seat_class` を足した。説明文に、席種の意味(プレミアムシート、内野指定席、ボックスシートなど。座席番号とは別)、次の席選びで「この席種は良かったか」を引けるようにできるだけ入れること、`list_seat_records` で絞り込めること、`screen` が映画館のスクリーンだけでなくホール・ブロック・エリアなどの区画にも使えることを書いた。ツール名・数(29個)は変えない
  - API: `POST` / `PATCH` / `GET /api/seat-records?seat_class=` / `GET /api/day/:date` の `seat_records` に反映。契約 `src/api/contract.ts` と UI の型を更新
  - 画面: 日の詳細のフォームに「席種(任意)」を座席の次に足した(50文字)。「スクリーン・ホール」のラベルは「スクリーン・エリア(任意。ホール・ブロックなど)」にした。一覧の行は、座席と評価の行に席種を添える(例「F-5(プレミアムシート) ★4」。席種が無ければ従来どおり)。PCの詳細ペインも同じ部品
  - バックアップ(JSONL): `seat_record` の行に `seat_class` を含める(列は `seat` の次)。`seat_class` の無い旧形式の行もインポートできる(後方互換。NULL)。空文字は NULL、50文字を超える行はその行だけエラー
  - テスト: `0010` の移行テストは、テーブルを作り直す 0010 を当て直すとき、後ろの 0011 も当て直す(`d1_migrations` から両方を消す)
- フェーズ5(カレンダー): PC幅のカレンダーで日をダブルクリックすると、その日の詳細ページ(`/day/:date`)へ移る(1回目のクリックで右ペインの選択は済む)。スマホ幅は従来どおりタップで詳細ページへ移る。キーボードは右ペインの「詳細を開く」リンクから移る
- フェーズ5(カレンダー): スマホ幅のカレンダーで日をタップすると、PC幅の右ペインと同じ中身(`DayPane`)を、下からのシート(`DaySheet`、`role="dialog"`、フォーカストラップ、Esc・背景・×で閉じる)で出す。「詳細を開く」でその日のページ(`/day/:date`)へ移る。PC幅に切り替わったらシートは閉じる。以前のスマホ幅は、タップで直接 `/day/:date` へ移っていた
- フェーズ5(カレンダー): スマホ幅のプレビューを、下からのシートから、ページ内(「今月の出来事」の下、「今月の祝日」の上)に差し込む形へ変えた。タップした日は背景色で示し、プレビューが見えるまで最小限スクロールする。下からのシート版(`DaySheet`)は、使わないがコードとして残してある(ユーザーの希望)。PC幅の右ペインは変更なし
- フェーズ5(速さ): 画面側に、メモリだけの短時間キャッシュを足した(`ui/src/api-cache.ts`、TTL 30秒、100件まで)。成功した GET だけをおぼえ、失敗はおぼえない。書き込み(POST/PATCH/DELETE、写真、インポート)をしたらすべて捨てる(書き込み前に始まった通信の結果も保存しない)。同じ GET が飛行中なら通信を共有する。取り出すたびに複製して返す。サーバーの応答は `private, no-store` のまま(共有の保存先に残さない)。他の端末や MCP からの書き込みは、最大30秒のあいだ見えないことがある。ページを読み込み直すと消える。サーバー側: `/api/*` に `Server-Timing: app;dur=ミリ秒` を付け、300ms 以上かかったものは「slow api: メソッド ルートの形 ステータス ミリ秒」としてログに残す(値は載せない)。カレンダーの月の問い合わせは、集計と出来事を同時に待つようにした
- 消費税の税率と税額(ユーザー指示): レシートに印字された税率と税額を記録し、期間ごとに税率別の税額を集計できるようにした。MCP と Web UI(手入力・編集)の両方から使う。以下、項目ごと
  - 方針: **レシートがマスター**。税率も税額も印字どおりに記録し、こちらで税額を計算して補わない。税率の表は持たない(税率は変わる。2年限定で食料品だけ1%にするような将来の税率も、0.5% のような小数も、そのまま入る)。既存の `tax_flag`(医療費控除・セルフメディケーション・寄附金控除)とは別物で、名前(`tax_rate` / `tax_lines`)と説明で区別する
  - データ: migration `0012_tax_lines.sql`(追加のみ。既存データはバックフィルしない)。`transaction_items` に `tax_rate`(REAL、0〜100、NULL=不明)と `tax_label`(TEXT、20文字まで)を ALTER TABLE ADD COLUMN で足した(CHECK 付き)。新テーブル `transaction_tax_lines`(第5節)。外部キーは依頼どおり `ON DELETE CASCADE` にした(既存の `transaction_items` は CASCADE なしで、core が明示して消している。内訳も core の削除の batch で明示して消すので、どちらでも同じ結果になる)
  - 検証(`src/core/tax-lines.ts` の Zod スキーマ1つで、add / update / API / JSONL を兼ねる): 税率は 0〜100 の数で、**小数第3位まで**(それより細かい値は誤読とみなしてエラー。依頼にない判断)。8 と 8.0 は同じ数(同じ税率)。記号は前後の空白を除き、空文字は値なし(null)、20文字まで。内訳の金額は0以上の整数(円)、10,000,000円まで。1取引の内訳は**10行まで**(依頼にない上限)。同じ税率の行が2つあればエラー。`amount_basis` は印字から分かるときだけ(省略可)
  - 合計の一致は強制しない。全行が税込で対象金額があるときは「対象金額の合計 = 取引の amount」、全行が税抜で対象金額と税額があるときは「対象金額+税額の合計 = amount」だけを確かめ、合わなければ `tax_warnings`(`{index?, field, message}[]`。add / update の戻りに常に入る。空配列もある)で知らせる。混在・欠けがあるときは確かめない。明細の tax_rate と内訳の税率の対応も確かめない
  - 表現: `ItemView` に `tax_rate` / `tax_label`、`TransactionView` に `tax_lines`(税率の高い順。なしは `[]`)。明細を付けるところ(`withItems`)で一緒に付けるので、取引を返す API・MCP の戻りにはすべて入る。`list_transactions` の `include_items: false` では items と tax_lines の両方を省く
  - 更新: `update_transaction` の `tax_lines` は全置換(省略・`null` は変更なし、`[]` で全消し、`tax_lines: null` だけの更新は「変更なし」のエラー)。items と同じ流儀
  - 集計 `summarizeTax`(MCP `summarize_tax`、API `GET /api/tax-summary`): 期間 from / to(省略は全期間)、`group_by` は `rate`(既定)/ `month`。**集計は tax_lines の印字どおりの数字だけを足す**(明細の tax_rate からは計算しない)。行ごとに `tax_total`・`taxable_total`(NULL は足さない)・`receipt_count`・`missing_tax_amount`・`taxable_basis`(税込 / 税抜 / 不明ごとの対象金額)・`mixed_basis`。`taxable_basis` は混在の有無にかかわらず常に出す(依頼は「混在する場合は分けて出す」。形をそろえるため常に出し、混在は `mixed_basis` で示す)。**カバレッジを必ず出す**: `coverage.without_tax_lines`(期間内の取引のうち、内訳が無い取引の件数と金額の合計)、`lines_missing_tax_amount` など。message にもカバレッジを書き、MCP の説明で AI に必ず伝えるよう指示した
  - MCP: ツールは29個から30個(`summarize_tax` を追加)。`add_transactions` / `update_transaction` / `list_transactions` / `delete_transaction` の入力と説明を更新。説明に「税率はレシートに印字された数字をそのまま入れる(計算しない)」「軽減税率の記号の書き方は店ごとに違うので、凡例を読んで数字にする。記号は tax_label に入れてよい」「税率別の内訳は tax_lines、税込か税抜かが分かるときは amount_basis」「内税・外税の別、記号の意味が不明、印字が薄い場合は推測せずユーザーに聞く」「tax_flag とは別物」を書いた
  - API: 既存の取引の POST / PATCH / GET に反映(旧形式の入力もそのまま通る)。`GET /api/tax-summary` を足した(既存のガードと no-store に乗る。空のクエリは省略扱い)
  - 画面: 明細ページの編集で、明細の行ごとに「税率」(未設定・10%・8%・0%・その他=数字の入力。選択肢は入力の手間を減らすだけで表ではない。選択肢に無い既存の値は「その他」に入れて表示・保存する)と「印字の記号」、レシート全体の「税の内訳」(行の追加・削除。税率・対象金額・消費税額・税込/税抜・記号)。保存後に `tax_warnings` があれば注意を出す。見るだけのビューは、明細の行に「8% ※」を小さく添え、税の内訳を表で出す。新しいページ `/tax`「税額」(期間の選択、税率別の表と合計、月別の切り替え、カバレッジの注記「税額の記録がない支出: N件(¥…)」、読み込み中・エラー・空の状態)。入口はホームの右上(スマホ)と PC の左メニュー。「今月」「先月」は月の初日〜末日、「今年」は1月1日〜12月31日(ホームの「今月」は月初〜今日だが、未来の支出は無いので結果は同じ)。日の詳細の「支出を追加」には税の欄を付けない(明細と同じく、登録後に明細ページで入れる)。純粋な部分は `ui/src/pages/taxLogic.ts`(上限は core と同じ値を持ち、テストで一致を確かめる)
  - バックアップ(JSONL): 明細の `item` 行に `tax_rate` / `tax_label` を足した。税の内訳は、明細と違って**取引の行に入れ子の配列 `tax_lines`**(`rate`, `taxable_amount`, `tax_amount`, `amount_basis`, `label`。id は出さない。税率の高い順。なしは `[]`)で持たせた(「取引の行に tax_lines を含める」という指示に合わせた。小さな表で取引と一緒に読み書きするため。往復で内訳の id は変わる)。旧形式(項目なし)の行もそのまま取り込める。往復一致のテストあり
  - テスト基盤: 各テストの前に `transaction_tax_lines` も空にする(`tests/setup.ts`)。0005 の移行テストは、`transaction_items` を作り直すとき 0012 も当て直す
- 店名の候補とレジ番号・店番号(ユーザー指示):
  - 店名の候補: 取引入力(日の詳細の「支出を追加」と `/tx/:id` の編集)の店名欄に、過去の取引から集めた候補を出す。`GET /api/merchants?q=&category=&limit=`(`limit` 既定8・最大20)。ロジックは `src/core/merchants.ts`(`listMerchants`)、検証は Zod 1つ。**候補は過去の取引から集める**(店のマスターテーブルは作らない)。**MCP のツールは作らない**(AI は `list_transactions` の `keyword` で足りる)
  - まとめ方: 店名ごと(全角半角・大文字小文字・空白・ひらがなカタカナの違いを吸収して同じ店にまとめ、表記は最新のもの)。`merchant` が NULL・空白だけの取引は除く。返り値は `merchant` / `count` / `last_date` / `category`・`account`(いちばん多く使った名前。同数なら新しいほう) / `phone`・`address`・`invoice_number`。電話・住所・登録番号は、「最新の取引から」を、項目ごとに**値のある最新の取引**から取る(最新の取引に電話が無くても、前に入れた電話を候補に出すため)
  - 絞り込み(`q`): 店名・住所・カテゴリ名は部分一致、電話番号は数字だけにして部分一致(`q` が数字・ハイフン・括弧・プラス・空白だけのとき)。絞り込みは SQL の LIKE ではなく JS で行う(全角半角・かなの違いを吸収するため。`%` `_` `\` は文字として扱う)ので、全取引を店名単位に集計して読む(個人用の件数では問題にならない規模)。`category` は完全一致で、その店のいちばん多いカテゴリが一致するものだけ(UI は今は使わない)。並びは(1)店名が前方一致、(2)件数の多い順、(3)最後に使った日の新しい順
  - 画面: WAI-ARIA のコンボボックス(`role="combobox"` / `listbox` / `option`、`aria-activedescendant`)。入力から約150msのデバウンスで API を呼ぶ。上下キーで選択、Enter で決定、Esc で閉じる。IME の変換中の Enter は決定にしない。読み込み中・候補なし(「新しい店として登録します」)・エラー(候補が出ないだけで入力は続けられる)を出す。**選んだときの自動入力は空欄にだけ**入れる(カテゴリ・口座・電話・住所・登録番号。すでに入力した欄は上書きしない。カテゴリ・口座は今ある名前のときだけ)。入れた欄は「前回の内容を入れました: …」と通知する。判定は `ui/src/merchantSuggest.ts` の純関数。「支出を追加」には電話などの入力欄を出さないが、候補から入った値はいっしょに登録する
  - レジ番号・店番号: レシートの情報に `register_no`(レジ番号。例 0005)と `store_code`(店番号・店舗コード。例 007832)を足した。`receipt_no` は引き続き「レシート番号・伝票番号」(例 P20261003152814)。任意・前後空白除去・空は未指定・30文字まで。migration `0013_register_store.sql`(`transactions` に `register_no TEXT` / `store_code TEXT`、追加のみ・バックフィルなし)。**`dedup_hash` には含めない**(含めると既存の重複判定が変わるため)。`keyword` 検索の対象には足していない。JSONL の `transaction` の行に含め、無い旧形式も取り込める
  - 時刻の表示: 明細ページの見るだけのビューは、日付の隣に「14:32」と時刻だけ出す(「決済時刻」のラベルを消した。レシートの時刻は決済時刻しかないため)。編集フォームのラベルは「時刻(日本時間)」に短くした。API・MCP の項目名 `paid_time` は変えない
  - AI向けの説明(MCP): `add_transactions` / `update_transaction` に、「メモには入れない(支払方法は account、レジ番号・伝票番号・店番号・電話・住所・登録番号・担当者は各項目、税の内訳は tax_lines)。メモはどの項目にも当てはまらない補足だけ」「支払方法が既存の口座にないときは、メモに書かず、先に list_categories で既存の口座を確認し(表記ゆれ注意)、ユーザーに確認してから add_account で追加して account に入れる」を明記した。`list_categories` / `add_account` / `memo` の説明も合わせた
- 割引の集計(お得金額、ユーザー指示「割引額の集計とかできると面白い。今月のお得金額が出る」): 以下、項目ごと。migration なし
  - 数えるもの: 支出の行(`spendLines`)のうち、**明細の行で `amount < 0` のものの絶対値の合計**(正の円)。取引全体の金額がマイナスのもの(明細なし)は、割引ではなく返品・払い戻しの可能性があるので数えない。**レシートに印字された割引行だけ**で、最初から安い値段や印字されないポイント還元は見えない(画面・docs・MCP の説明に明記)
  - core: `summarizeDiscounts`(`src/core/discounts.ts`)。入力は `from` / `to`(省略は全期間)と `group_by`(`none`=既定 / `merchant` / `category` / `month`)。戻りは `total`・`line_count`・`receipt_count`(割引の行を持つ取引の件数)・`spend_total`(同じ期間の支出の合計。`summarize` の total と同じ定義)・`rows`(`none` のときは空。`key`・`total`・`line_count`・`receipt_count`)。カテゴリは行の実効カテゴリ(行のカテゴリ、なければ取引のカテゴリ。なしは「(未分類)」)、店は取引の merchant(NULL は「(店名なし)」)。並びは合計の大きい順・同額は key の昇順。**month だけは summarize に合わせて古い順**(依頼は「合計の大きい順」だが、月別は時系列で見るため)。rows の件数に上限は設けない(summarize と同じ)
  - MCP: **ツールは増やさない**(30のまま)。`summarize` に `discounts_only`(boolean、任意)を足し、true のとき `summarizeDiscounts` を呼ぶ(入口は core の `summarizeForTool`)。`group_by` は MCP のスキーマ上は任意にし、`discounts_only` が true のときだけ省略でき(`none` も指定できる)、それ以外の `group_by` の必須チェックと検証は従来の `summarize` が行う(`discounts_only` なしの入力と返り値は変わらない)。`discounts_only: true` で `group_by` が割引にない値(event_id など)ならエラー
  - API: `GET /api/discounts?from=&to=&group_by=`(空のクエリは省略扱い、既存のガード・no-store)。`HomeData` に `discounts: {month_total, month_line_count}` を足した(今月は `month` と同じ範囲=月初〜月末。未来の支出は無いので月初〜今日と同じ)
  - 画面: ホームに「今月の割引」のカード(合計「¥1,230」、「3件の割引」、なければ「今月の割引はまだありません」、補足「印字された割引行のみ」)。スマホは「メモ付きの支出」の下、PC(900px〜)は今日/今月/メモの行の下の横長の帯。詳細ページは作らない(カードは押せず、AI への誘導も出さない)。純粋な整形は `ui/src/pages/homeLogic.ts` の `discountsView`
- フェーズ5(ホームの内訳): 内訳を、積み上げ棒から**ドーナツグラフ**に変えた(`DonutChart`、`donutSlices`)。リングの中に、大きい順に最大5つ、10%以上の区分だけ % を入れる(文字色は背景との対比で白系か黒系を選ぶ。真っ白・真っ黒は使わない)。中央に今月の合計。PC幅はドーナツの右に一覧、スマホ幅はドーナツを左右の中央に置いて下に一覧。「メモ付きの支出」のカードは、日々の役に立たないので外した(API の `HomeData.memo` は残す=後方互換)。PC幅の「今月の割引」は、以前のメモ付きの場所(今日・今月の右)に置く。ロゴの白は `#F1F4F2`、黒は `#1B2420`(目に優しい白・黒)
