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
- 完了条件は常に `npm run check`(型チェック、lint、vitest)が通ること

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
- 明細行は持たず、合計額だけにする

**categories**: id, name(UNIQUE), group_name(集計用の大分類)。初期データは seed で入れる(例: 食費、日用品、交通・チャージ、娯楽、その他)
**accounts**: id, name(UNIQUE)。現金、カード、Suica程度のラベル。残高は持たない
**events**: id, start_date, end_date(単日はNULL), title, note, color(red / orange / green / blue / purple のいずれか。色コードはUI側)
**attachments**: id, r2_key, date, transaction_id, event_id, caption, created_at。date、transaction_id、event_id のうち1つ以上を持つ

収入は持たない(後から取引に種別の列を足す)。

## 6. MCPツール

Streamable HTTPで、ステートレスに実装する。ツールの説明文とスキーマがAIへの仕様書になるので、項目の意味、必須と任意、選べる値を必ず書く。

| ツール | 役割 |
| --- | --- |
| add_transactions | 取引を配列で登録。1レシート1件。写真1枚に複数のレシートがあれば、別々の取引にする。全件成功か全件ロールバック(D1のbatch) |
| list_transactions | from、to、category(任意)で一覧 |
| update_transaction / delete_transaction | 修正と削除 |
| summarize | 期間と group_by(category、group、month、merchant、event_id)で集計。件数、合計、全体に対する割合 |
| list_categories | AIが既存カテゴリに寄せるために使う |
| add_event / update_event / list_events | 日付や期間のメモ(色つき) |
| query(候補) | 読み取り専用のSELECT。行数上限あり。後から追加してよい |

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

AIで読み取る場所ではなく、カレンダーで振り返りながら、写真とメモを足す場所。AI機能は持たない。

- **ホーム**: 今日と今月の合計を主役にし、すぐ横に大分類別の金額と全体に対する割合、メモ付き支出の割合を置く
- **月カレンダー**: 日ごとの支出合計、メモの色、写真の有無
- **日の詳細**: 取引一覧、メモ、写真。取引の修正、カテゴリの変更、メモの追加、写真の添付
- **期間メモ**: カレンダー上に帯で描き、重なる場合は段を分ける
- **エクスポート**への導線
- 写真は、ブラウザ側で長辺1600px程度に縮小してからアップロードする。配信は認証を通したWorker経由で、R2は公開しない
- 簡易集計は `summarize` と同じ関数を使う。凝った分析はUIに作り込まない

## 9. エクスポートとインポート

優先順位は JSONL > Markdown > HTML。

- **JSONL(+写真)**: 完全バックアップ。1行1レコードで、`type`(transaction / event / attachment)で区別する。写真は photos フォルダに入れ、JSONLと一緒にzipにする
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
- `npm run check` は当面 tsc → eslint → vitest。UIが入ったら範囲を広げる
