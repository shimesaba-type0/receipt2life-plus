# セットアップ(人間が行う作業)

エージェントは、ここに書かれた作業を代わりに行いません。手順は育てていきます。
スマホだけでも進められる作業を先に、Cloudflare のコマンド操作が要るものを後に並べています。

## スマホでできる(ブラウザだけ)

1. GitHub: Settings → General で、PRの作成を **コラボレーター(自分)だけに制限**する(Pull requests 自体を無効化しない。このリポジトリは自分のPRでCI/CDを回すため、無効化するとPRが作れなくなる)
2. GitHub: Settings → Advanced Security → **Private vulnerability reporting を有効化**
3. GitHub: Settings → Environments で `staging` と `production` を作る(`production` には承認者を付ける)
4. GitHub: Settings → Rules → Rulesets → New ruleset → **Import a ruleset** で `.github/rulesets/protect-main.json` を読み込む(PR必須、`test` を必須チェック、force push と削除を禁止)
5. Cloudflare ダッシュボードで D1 と R2 を作る(ステージングと本番を別々に)
6. Cloudflare ダッシュボードで API トークンを作る(ステージング用と本番用を分ける)
   → GitHub の各 Environment に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録

## PC があるときに行う

- `wrangler.toml` に D1/R2 のバインディングを書く(IDは書かない方針。方法はフェーズ2で決める)
- Cloudflare Access のアプリ作成、Managed OAuth、DCR 許可リストの登録
- Claude.ai と ChatGPT のコネクタ接続の検証
- 使うドメインとサブドメインの決定

CI/CD の詳細は [ci-cd.md](ci-cd.md)。
