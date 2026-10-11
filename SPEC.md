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
| dedup_hash | TEXT NOT NULL | 日付+金額+正規化した店名のSHA-256。索引は付けるが、UNIQUEにはしない |
| created_at, updated_at | TEXT | |

- 必須は金額だけ。読み取れなかった項目は空欄のまま登録でき、不完全なものには needs_review を付ける
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

**categories**: id, name(UNIQUE), group_name(集計用の大分類)。初期データは seed で入れる(例: 食費、日用品、交通・チャージ、娯楽、その他)
**accounts**: id, name(UNIQUE)。現金、カード、Suica程度のラベル。残高は持たない
**events**: id, start_date, end_date(単日はNULL), title, note, color(red / orange / green / blue / purple のいずれか。色コードはUI側)
**attachments**: id, r2_key, date, transaction_id, event_id, caption, created_at。date、transaction_id、event_id のうち1つ以上を持つ

収入は持たない(後から取引に種別の列を足す)。

## 6. MCPツール

Streamable HTTPで、ステートレスに実装する。ツールの説明文とスキーマがAIへの仕様書になるので、項目の意味、必須と任意、選べる値を必ず書く。

現在は19個(取引4、集計・参照2、カテゴリ管理4、出来事3、写真3、リンク3)。`src/mcp/tools/*` が正。

| ツール | 役割 |
| --- | --- |
| add_transactions | 取引を配列で登録。1レシート1件。写真1枚に複数のレシートがあれば、別々の取引にする。明細(items)を行ごとに付けられる。全件成功か全件ロールバック(D1のbatch) |
| list_transactions | from、to、category、tax_flag(任意)で一覧。明細(items)つき |
| update_transaction / delete_transaction | 修正(明細は全置換)と削除(delete_photos で写真もいっしょに) |
| summarize | 期間と group_by(category、group、month、merchant、event_id、tax_flag)で集計。単位は支出の行。件数、合計、全体に対する割合 |
| list_categories | AIが既存カテゴリに寄せるために使う。大分類ごとのまとまりと使用数つき |
| add_category / update_category / delete_category / rename_group | カテゴリ(大分類の下のサブカテゴリ)の管理 |
| add_event / update_event / list_events | 日付や期間のメモ(色つき) |
| create_photo_upload_link / list_photos / get_photos | 写真の登録は Web UI の /photos/add へのリンクを返す。一覧と画像の取得 |
| add_link / list_links / delete_link | Xの投稿・YouTubeの動画のリンク |
| query(未実装・候補) | 読み取り専用のSELECT。行数上限あり。現在のツール19個には含まれない。入れるかは第13節の未決事項 |

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
- **税金フラグ**: 取引と明細の行に、医療費控除・セルフメディケーション税制・寄附金控除のフラグを1つ付けられる(取引の追加・編集のフォーム、明細ページ)。年ごとの集計はMCPの `summarize`(`group_by: "tax_flag"`)で行い、画面には集計を出さない
- 写真は、ブラウザ側で長辺1600px程度に縮小してからアップロードする。配信は認証を通したWorker経由で、R2は公開しない
- 簡易集計は `summarize` と同じ関数を使う。凝った分析はUIに作り込まない
- 暫定: UIは Vite + Preact のSPA(第13節「フェーズ5(UI)」)。スマホは下のタブ(ホーム / カレンダー / 今日)、PCは左のメニュー(ホーム / カレンダー / カテゴリ / エクスポート)

## 9. エクスポートとインポート

優先順位は JSONL > Markdown > HTML。

- **JSONL(+写真)**: 完全バックアップ。1行1レコードで、`type`(transaction / item / event / attachment / link)で区別する。写真は photos フォルダに入れ、JSONLと一緒にzipにする
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

- フェーズ5(API・集計): 未定義の `/api/*` は404のJSON。id が存在しないエラーは、core のエラー文言(`field==="id"` と「〜はありません」)で404に変換する(文言に依存する)。ホームの集計は、メモ付き支出の割合が今月の取引、要確認の件数と最近の取引5件が全期間。カレンダーの写真枚数と日詳細の写真は、日付そのもの・その日の取引・その日と重なる出来事のどれかに紐づく写真を、重複なく数える。`GET /api/categories` は `categories` と `accounts` だけ返す。PATCH のパスの id が本文の id に優先する
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
