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

## Cloudflare に Worker を追加するときの値(下調べ。画面の名前は変わりやすい)

注意: 調査した環境から Cloudflare の公式ドキュメントに繋がらず、検索結果の要約だけが根拠です。**メニュー名と値は、実画面か公式ドキュメントで確認してください**。確認できなかった点は「未確認」と書いています。

### GitHub Actions でデプロイするための値

| 名前 | 置き場所 | 内容 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub の各 Environment の Secrets | Account 所有の API トークン。権限は「Edit Cloudflare Workers」のテンプレート/Custom を、デプロイ先のアカウント1つに絞る。D1 のマイグレーションを CI で行うなら D1 の編集権限が別に要る可能性がある(未確認) |
| `CLOUDFLARE_ACCOUNT_ID` | 同上 | アカウントID。ダッシュボードの Overview 付近(現在のメニューは未確認) |

- ステージング用と本番用でトークンを分ける。Worker 単位で絞れるかは未確認
- 新規 Worker の初回作成には、既存 Worker の編集より強い権限が要るかもしれない(未確認)

### wrangler.toml(リポジトリ側。値は書かない)

- `workers_dev = false` と `preview_urls = false` を明示済み(workers.dev とプレビューURLを無効にする)。ダッシュボードで切り替えても、次のデプロイで wrangler.toml の値に上書きされる
- D1 は `binding` / `database_name` / `database_id` を持つ。このリポジトリは `database_id` を書かず、wrangler(4.45以降)の**自動プロビジョニング**でデプロイ時に作る想定。実際に動くかは**未確認**(動かなければ、ダッシュボードで作った ID を CI の環境変数などで差し込む方法を別途決める)
- ステージングは `[env.staging]` で別の Worker 名・別の D1 にしてある。R2 はフェーズ5で追加

### Cloudflare Access で Worker を守る

方法A(ドメイン不要、最短): Workers & Pages → 対象の Worker → Settings → Domains & Routes → workers.dev(またはプレビューURL)の **Enable Cloudflare Access** → Manage Cloudflare Access で許可するメールを編集する。

方法B(Zero Trust の self-hosted application): アプリ名、public hostname(Cloudflare に登録したドメインが必要)、Policy(Action=Allow、Include=Emails など)、IdP(ワンタイムPINなど)、セッション期間を入力する。workers.dev のホスト名で作れるかは未確認。

### Worker 側に必要な値(JWT 検証)

| 名前 | 内容 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `<チーム名>.cloudflareaccess.com`(`https://` は付けても付けなくてもよい)。確認場所は未確認 |
| `ACCESS_AUD` | Access アプリの Application Audience (AUD) タグ。現在の画面での場所は未確認 |

- この2つは**シークレット/環境変数**として設定する(リポジトリに書かない)。**空だと全リクエストを拒否する**
- JWT は `Cf-Access-Jwt-Assertion` ヘッダー。JWKS は `https://<チーム名>.cloudflareaccess.com/cdn-cgi/access/certs`。検証するのは `iss`(`https://<チーム名>.cloudflareaccess.com`)、`aud`、`exp`

### ステージングの自動テスト用 Service Token

Zero Trust → Access controls → Service credentials → Service Tokens で作成する。Client ID と Client Secret が出る(Secret は一度しか表示されない)。Access の Policy は **Action=Service Auth**(Allow だとログイン画面になる)で、そのトークンを Include する。リクエストには `CF-Access-Client-Id` と `CF-Access-Client-Secret` を付ける。サービストークンの JWT に email が入るかは未確認なので、コードは email を必須にしていない。

### MCP 用の Managed OAuth

self-hosted application の編集 → Advanced settings → Managed OAuth をオン。クライアントは RFC 8707 に対応している必要がある。「Allowed redirect URIs」に、接続するクライアントのコールバックURL(https、末尾 `/*` 可)を登録する。Claude.ai と ChatGPT のコールバックURLは**未確認**(各社の公式ドキュメントで確認する)。ホスト名が要る方法Bが前提になる可能性が高く、その場合ドメインが必要。

### スマホだけで進める順番(案)

1. API トークンを作り、GitHub の Environment に Secrets を登録する(上の表)
2. 4 までの準備ができるまで、`CLOUDFLARE_DEPLOY_ENABLED=true` は設定しない(CI のデプロイは止めたまま)
3. ステージングをデプロイしたあと、方法Aで Access を有効にする
4. AUD タグと team domain を確認し、Worker のシークレットに設定する
5. Service Token(自動テスト用)と、MCP 用の Managed OAuth は後回しでよい
