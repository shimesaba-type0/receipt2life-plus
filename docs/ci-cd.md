# CI/CD

ワークフロー: `.github/workflows/ci.yml`

| きっかけ | 動くもの |
| --- | --- |
| Pull request | `npm run check` → 通ればステージング(開発環境)へデプロイ |
| main へ push(マージ) | `npm run check` → 通れば本番へデプロイ |

`npm run check` は、型チェック → lint → テスト(vitest) → ビルド(`npm run build`。Web UI を `ui/dist` に作る)の順に実行する。デプロイは、変数 `CLOUDFLARE_DEPLOY_ENABLED` が `true` のときだけ動く(今は未設定なので、テストだけが動く)。

## 人間が行う設定(値はリポジトリに書かない)

1. GitHub の Settings → Environments で `staging` と `production` を作る
   - `production` には、必要なら承認者(Required reviewers)を付ける
2. 各 Environment の Secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録する
   - トークンは環境ごとに分け、`staging` 用は本番を触れない権限にする
3. `wrangler.toml` の `[env.staging]` は定義済み(別の Worker・D1・R2。`database_id` は書かない)。実環境(ステージングの Worker・D1・R2・サービストークン)は未作成なので、手順は [setup.md](setup.md) の「まだ手を付けていないこと」を参照
4. 準備ができたら、リポジトリの Variables に `CLOUDFLARE_DEPLOY_ENABLED=true` を設定する
   - 設定するまでは、テストだけが動き、デプロイは動かない
5. Settings → Branches で main を保護し、`test` を必須チェックにする

## 注意

- CI のデプロイ手順(本番・ステージング)は、`wrangler deploy` の直前に D1 のマイグレーションを当てる(Cloudflare 側のデプロイコマンドと揃えてある)
  - 本番: `npx wrangler d1 migrations apply DB --remote` → `wrangler deploy`
  - ステージング: `npx wrangler d1 migrations apply DB --remote --env staging` → `wrangler deploy --env staging`
  - 理由: マイグレーションを当てずにデプロイすると、新しい列やテーブルが無く画面が500になる(docs/setup.md)
- `CLOUDFLARE_DEPLOY_ENABLED=true` にする前に確認すること
  - Cloudflare 側の GitHub 連携の自動デプロイ(同じマイグレーションとデプロイを行う)と二重に動かない。どちらか一方に決める
  - 各 Environment の API トークンに、D1 の編集権限が含まれている(`staging` 用は本番の D1 を触れない)
  - ステージングの実環境(Worker・D1・R2)が作られ、Secrets(`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`)が入っている
  - `production` に承認者を付けている(マイグレーションは本番のデータを変えるため)
  - デプロイ用のジョブに、Web UI のビルド(`npm run build`)の手順がまだ無い。`wrangler.toml` の `assets` は `ui/dist` を指すので、有効にする前に、ビルドの手順を足すかを決める
  - 追加だけのマイグレーションであること(列・テーブルの削除や型の変更を含むものは、先に人間が確認する)
- エージェントはデプロイコマンドを手元で実行しない(デプロイはこのCIだけが行う)
- Cloudflare の自動デプロイ(Workers Builds)が、一時的な 504 などで失敗することがある。失敗した行や古い行を「再デプロイ」しない(古いコードに戻るおそれがある)。もう一度デプロイしたいときは、最新の main のビルドを再実行するか、次のマージを待つ
