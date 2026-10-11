# receipt2life+

日々の支出を中心に、出来事や思い出も一緒に記録できる、自分専用のライフログアプリ。

- 入力は主に AI(Claude、ChatGPT)から MCP 経由で行い、見返しは専用の Web UI で行う
- Cloudflare Workers(Hono)+ D1 + R2 で動く
- 仕様は [SPEC.md](SPEC.md)、開発ルールは [AGENTS.md](AGENTS.md)
- 公開の手順は [docs/setup.md](docs/setup.md)、AI(Claude)との接続は [docs/connect-claude.md](docs/connect-claude.md)、バックアップは [docs/backup.md](docs/backup.md)

## 開発

```
npm install
npm run check   # 型チェック、lint、テスト
npm run dev     # ローカル起動(wrangler dev)
```

## 公開方針

ソースは公開し、フォークは自由です(AGPL-3.0)。**プルリクエストは受け付けていません。** Issue は歓迎します。
脆弱性は [SECURITY.md](SECURITY.md) に従って報告してください。

## ライセンス

GNU Affero General Public License v3.0
