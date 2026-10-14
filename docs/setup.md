# セットアップ(人間が行う作業)

エージェントは、ここに書かれた作業を代わりに行いません。手順は育てていきます。
スマホだけでも進められる作業を先に、Cloudflare のコマンド操作が要るものを後に並べています。

## スマホでできる(ブラウザだけ)

1. GitHub: Settings → General で、PRの作成を **コラボレーター(自分)だけに制限**する(Pull requests 自体を無効化しない。このリポジトリは自分のPRでCI/CDを回すため、無効化するとPRが作れなくなる)
2. GitHub: Settings → Advanced Security → **Private vulnerability reporting を有効化**
3. GitHub: Settings → Environments で `staging` と `production` を作る(`production` には承認者を付ける)
4. GitHub: Settings → Rules → Rulesets で main 用のルールセットを新規作成する(ルールの中身は各自のポリシーで決める。このプロジェクトでは、PR必須・`test` を必須チェック・force push と削除を禁止・bypass なし、で運用している)
5. Cloudflare ダッシュボードで D1 と R2 を作る(ステージングと本番を別々に)
6. Cloudflare ダッシュボードで API トークンを作る(ステージング用と本番用を分ける)
   → GitHub の各 Environment に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録

## PC があるときに行う

- `wrangler.toml` の D1/R2 のバインディングは、すでに書いてある(`DB`、`PHOTOS`。ID は書かない方針で、デプロイ時の自動プロビジョニングに任せる)。ステージング用の `[env.staging]` も定義済み
- Cloudflare Access のアプリ作成、Managed OAuth、DCR 許可リストの登録
- Claude.ai と ChatGPT のコネクタ接続の検証
- 使うドメインとサブドメインの決定

CI/CD の詳細は [ci-cd.md](ci-cd.md)。

## Cloudflare に Worker を載せる(実際にやった手順。確認済み)

画面の名前は変わりやすいので、違っていたら近い名前の項目を探してください。ドメインやIDなどの実値は、ここには書きません。

### 1. Worker を GitHub 連携で作る

Workers & Pages → 新規作成 → **Continue with GitHub** → このリポジトリを選ぶ(GitHub App は、このリポジトリだけに許可する)。

| 項目 | 値 |
| --- | --- |
| プロジェクト名(Worker名) | `receipt2life`(`wrangler.toml` の `name` と同じにする) |
| ビルドコマンド | `npm run build`(Web UI を `ui/dist` に作る。フェーズ5から必要) |
| デプロイコマンド | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy --env=""`(**必ずこの1行**。`npx wrangler deploy` だけだと、新しい列やテーブルが作られず、画面が500になる) |
| プレビュービルド | オフ(PRのテストは GitHub Actions が行う) |
| Cloudflare Access で保護 | オフ(あとで Zero Trust で設定する) |

- D1 は、`wrangler.toml` に `database_id` を書かなくても、**初回のデプロイで自動作成される**(確認済み)。テーブルは、デプロイコマンドの `d1 migrations apply` が作る
- `workers_dev = false` / `preview_urls = false` にしてあるので、`workers.dev` の URL は無い。次のカスタムドメインで公開する
- main にマージすると、Cloudflare が自動でビルドとデプロイを行う。GitHub Actions 側のデプロイは止めたまま(`CLOUDFLARE_DEPLOY_ENABLED` を設定しない)

### 2. カスタムドメインを付ける

前提: ドメインが、同じ Cloudflare アカウントで管理されていること。
Worker → ドメイン → 「ドメインを追加」→ カスタムドメイン → サブドメインとドメインを入力。有効化対象は **本番**(プレビューは付けない)。DNS と証明書は自動で作られる。

### 3. Access で守る

Zero Trust(初回はチーム名を決める。`<チーム名>.cloudflareaccess.com` になる)→ Access controls → アプリケーション → 追加 → **セルフホストとプライベート** の中の **Workers** を選ぶ。

- スコープに Worker(`receipt2life`)、タイプに「Worker のプロダクション URL とプレビュー URL」を選ぶ。**これで、カスタムドメインも守られる**(確認済み)
- ポリシー: Allow、Include は Emails で自分のメールアドレス。ログイン方法はワンタイムPIN か Cloudflare
- ログイン画面の宛先に出るホスト名が `ACCESS_TEAM_DOMAIN` の値になる
- アプリの「追加設定」タブの **AUD タグ** の「トークン」の欄が `ACCESS_AUD` の値になる

### 4. Worker にシークレットを入れる(つまずきやすい)

Worker → 設定 → **ランタイム変数とシークレット**(「プロダクション」タブ)→ 「変数を追加する」で、種類を**シークレット**にして追加する。

| 名前 | 値 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `<チーム名>.cloudflareaccess.com` |
| `ACCESS_AUD` | Access アプリの AUD タグ |

- **「ビルド」の中の「変数とシークレット」は別物。** ビルド中だけ使われ、動いている Worker には渡らない。ここに入れても、Worker は「未設定」と言って全拒否する
- 「プレビュー」にはチェックを入れない
- 普通の変数(テキスト)は、デプロイで上書きされることがあるので、`wrangler.toml` に `keep_vars = true` を入れてある。迷ったらシークレットにする
- 確認: ブラウザで `https://<サブドメイン>.<ドメイン>/healthz` を開き、ログインして `{"ok":true}` が出れば成功。出なければ、Worker の Observability(ログ)の `auth: ...` の行に理由が出る(`claim=aud` なら AUD が違う、変数名が出たらそれが未設定)

### 5. MCP の接続(Managed OAuth)

Access アプリの「追加設定」タブで **Managed OAuth** をオンにする。ローカルホスト系の許可はオフ。**許可するリダイレクト URI** に、使うクライアントのコールバックURLを入れる。接続の手順は [connect-claude.md](connect-claude.md)。

### 6. 画面(Web UI)を出す

- Worker → 設定 → ビルド → **ビルドコマンド** を `npm run build` にする(空のままだと画面のファイルが作られない)
- R2 は、`wrangler.toml` の `PHOTOS`(バケット名 `receipt2life`)をデプロイ時に自動で作る想定。デプロイ後に、ダッシュボードの R2 に `receipt2life` があるか確認する。無ければ R2 → バケットを作成 → 名前 `receipt2life`
- ホーム画面に追加(PWA)して使うなら、Zero Trust → Access → アプリケーション → ポリシーで、次の3つのパスだけ **Bypass** にする: `/manifest.webmanifest`、`/sw.js`、`/icons/*`(認証情報を含まない静的ファイル)。しないと、アイコンが出ない、更新に失敗する、といった不具合が出ることがある(未検証)
- Access のクッキーの SameSite は Lax 以上にしておく(書き込み系は Origin も検査するが、二重の備え)

### 7. 使用量のグラフ(任意。人間が行う)

D1 の無料プランには、**1日あたり**の上限(読んだ行 500万、書いた行 10万。UTC の0時=日本時間の午前9時にリセット)がある。超えると、その日は D1 に問い合わせできず、アプリが使えなくなる(請求はされない)。メニューの「使用量」に、今日の使用量(上限に対する%)と直近30日のグラフを出すには、次の設定をする。**設定しなくても、アプリはそのまま使える**(「使用量」には、設定の案内が出る)。

1. Cloudflare → アカウントの **API トークン**(Account API tokens)→ トークンを作成 → **カスタムトークン**。
   - 権限は **アカウント → アカウント分析(Account Analytics)→ 読み取り(Read)** の1つだけ。ほかの権限は付けない
   - 名前は分かりやすいもの(例: `usage-read`)。有効期限は、決めておくとよい(切れたら作り直す)
2. 作ったトークンを、その場でコピーする(あとから見られない)。
3. Worker → 設定 → **ランタイム変数とシークレット**(「プロダクション」タブ)→ 「変数を追加する」で、種類を**シークレット**にして、次の3つを入れる(つまずきやすい点は、上の「4. シークレット」と同じ)。

| 名前 | 値 |
| --- | --- |
| `CF_API_TOKEN` | 手順2のトークン |
| `CF_ACCOUNT_ID` | Cloudflare のアカウントID(ダッシュボードの URL や、Workers & Pages の概要に出る) |
| `D1_DATABASE_ID` | このアプリの D1 データベースのID(D1 → データベースの詳細に出る) |

4. 保存したら、メニューの「使用量」を開く。数字が出れば完了。「権限」のエラーが出たら、トークンの権限(Account Analytics: Read)と、アカウントID・データベースIDの取り違えを確認する。

- トークンとIDは、リポジトリ・文書・コミットに書かない(秘密)。ローカル開発(`.dev.vars`)でも、本番のトークンは入れない
- 読み取り専用のトークンなので、万一漏れても、使用量を読まれるだけ。ただし、漏れたと思ったら、トークンを作り直して入れ替える
- 取得は5分ごと(同じ結果をキャッシュ)。Cloudflare の分析 API の呼び出しは無料
- 使用量が上限の70%を超えると、ホームに「注意」が出る(90%を超えると「上限に近い」)。問題があるときだけ、Cloudflare のダッシュボードを開けばよい

### 書き込みの回数の制限

暴走・無限ループよけに、アプリ側で書き込みの回数を数えて、短時間に多すぎたら止める(429)。画面・API・インポートの書き込みは **1分に120回まで**、MCP は **1分に240回まで**(超えると、待つ秒数つきのエラーを返し、DB には書かない)。数えるのは Worker のインスタンスごとの最良努力で、制限のための書き込みはしない(D1 の書き込みを増やさない)。確実な上限が必要になったら、Cloudflare の Rate Limiting(設定が必要)を足す。

### 環境変数(ローカル開発)

ローカル(`npm run dev`)の設定は、リポジトリ直下の `.dev.vars` に書く(**gitignore 済み。コミットしない**)。雛形は `.dev.vars.example`。実際の値はここにも雛形にも書かない。

- `AUTH_BYPASS`: ローカル開発専用の認証の素通り。`1` のときで、かつリクエストのホストが localhost のときだけ有効。**本番やステージングには設定しない**(設定しても localhost 以外では効かないが、置かない)
- `CF_API_TOKEN` / `CF_ACCOUNT_ID` / `D1_DATABASE_ID`: 使用量のグラフ用(任意)。本番のトークンはローカルに入れない(上の「7」)
- `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`: Access の JWT 検証用。空だと全リクエストを拒否する(フェイルクローズ)。本番では上の手順 4 のとおりシークレットとして入れる

### まだ手を付けていないこと

- ステージングの実環境: `wrangler.toml` の `[env.staging]` は定義済みだが、実環境(`receipt2life-staging` の Worker、D1、R2、サービストークン、Access のアプリ)は未作成
- GitHub Actions からのデプロイ(`CLOUDFLARE_DEPLOY_ENABLED`)。未設定のまま。ステージングを作るときに使う予定(有効にする前の確認事項は [ci-cd.md](ci-cd.md))
