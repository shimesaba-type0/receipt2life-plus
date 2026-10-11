# CI/CD

ワークフロー: `.github/workflows/ci.yml`

| きっかけ | 動くもの |
| --- | --- |
| Pull request | `npm run check` → 通ればステージング(開発環境)へデプロイ |
| main へ push(マージ) | `npm run check` → 通れば本番へデプロイ |

## 人間が行う設定(値はリポジトリに書かない)

1. GitHub の Settings → Environments で `staging` と `production` を作る
   - `production` には、必要なら承認者(Required reviewers)を付ける
2. 各 Environment の Secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録する
   - トークンは環境ごとに分け、`staging` 用は本番を触れない権限にする
3. `wrangler.toml` に `[env.staging]` を用意する(別のD1・R2・Workerにする。IDはプレースホルダーのまま、実値はWrangler/Secrets側で扱う)
4. 準備ができたら、リポジトリの Variables に `CLOUDFLARE_DEPLOY_ENABLED=true` を設定する
   - 設定するまでは、テストだけが動き、デプロイは動かない
5. Settings → Branches で main を保護し、`test` を必須チェックにする

## 注意

- D1のマイグレーションは、まだCIに入れていない。入れるときは別途決める
- エージェントはデプロイコマンドを手元で実行しない(デプロイはこのCIだけが行う)
