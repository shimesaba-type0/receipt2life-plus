# receipt2life+

日々の支出を中心に、出来事(メモ)や写真も一緒に残せる、自分専用のライフログアプリ。

- 入力は主に AI(Claude、ChatGPT)から MCP 経由で行い、見返しと写真・メモの追加は専用の Web UI で行う
- 公開サービスではなく、自分だけが使う(Cloudflare Access で保護)

## できること

- 支出の登録・修正・削除(レシート写真を AI に読み取らせて登録、カテゴリ・口座・税金の控除用フラグ付き)
- 日付や期間の出来事(メモ。色付き、カレンダーに帯で表示)
- 写真の添付(複数追加・複数削除)、X の投稿・YouTube の動画のリンクの記録、映画館などの座席の記録(会場・スクリーン/エリア・座席・席種・評価。会場とスクリーンは別のレコードで、スクリーンごとの特徴メモも持てる)
- 月カレンダー(祝日、月ジャンプ)、日の詳細、ホームの合計と内訳
- 期間・カテゴリ・店名・税金フラグ別の集計、レシートに印字された消費税の税率別の集計(税率・税額は印字どおりに記録し、計算しない)
- JSONL のバックアップ(エクスポート)と読み込み(座席の記録、会場・スクリーンを含む)

使い方は [docs/guide.md](docs/guide.md)。

## 構成

- Cloudflare Workers(Hono)+ D1(データ)+ R2(写真。公開しない)
- MCP サーバー(Streamable HTTP、`/mcp`)。ロジックは `src/core` に置き、MCP と API が同じ関数を呼ぶ
- Web UI(Preact + Vite、`ui/`)。PWA としてホーム画面に追加できる
- 認証は Cloudflare Access

## ドキュメント

- [docs/index.md](docs/index.md): 目次
- [docs/guide.md](docs/guide.md): 使い方
- [docs/setup.md](docs/setup.md): セットアップ
- [docs/connect-claude.md](docs/connect-claude.md): Claude との接続
- [docs/api.md](docs/api.md): Web UI 用 API
- [docs/backup.md](docs/backup.md): バックアップ
- [docs/ci-cd.md](docs/ci-cd.md): CI/CD
- [SPEC.md](SPEC.md): 仕様
- [AGENTS.md](AGENTS.md): 開発ルール

## 開発

```
npm install
npm run check      # 型チェック、lint、テスト、ビルド(完了条件。CI も同じ)
npm run typecheck  # 個別実行
npm run lint
npm run test
npm run dev        # ローカル起動(wrangler dev)
```

デプロイは CI だけが行い、手元では実行しません([docs/ci-cd.md](docs/ci-cd.md))。実データと秘密(キー、アカウントID、ドメインなど)はリポジトリに置きません。

## 公開方針

ソースは公開し、フォークは自由です(AGPL-3.0)。**プルリクエストは受け付けていません。** Issue は歓迎します。
脆弱性は [SECURITY.md](SECURITY.md) に従って報告してください。

## ライセンス

GNU Affero General Public License v3.0([LICENSE](LICENSE))
