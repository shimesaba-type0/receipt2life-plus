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

- `wrangler.toml` に D1/R2 のバインディングを書く(IDは書かない方針。方法はフェーズ2で決める)
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
| ビルドコマンド | 空 |
| デプロイコマンド | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy --env=""` |
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

### まだ手を付けていないこと

- ステージング環境(別の Worker、別の D1、サービストークン)
- GitHub Actions からのデプロイ(`CLOUDFLARE_DEPLOY_ENABLED`)。ステージングを作るときに使う予定
