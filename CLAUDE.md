@AGENTS.md

# Claude Code 向けの補足

- 共通ルールは上の AGENTS.md。ここには Claude Code 固有のことだけを書く
- 個人用のローカル設定は `CLAUDE.local.md` と `.claude/settings.local.json`(どちらも gitignore 済み)
## 開発コマンド

- `npm run check`: 型チェック → lint → vitest → build(完了条件。CIも同じものを実行する)
- `npm run typecheck` / `npm run lint` / `npm run test`: 個別実行
- `npm run dev`: ローカル起動(wrangler dev)。デプロイ系のコマンドは手元で実行しない

## 要約

- 仕様は SPEC.md。実データと秘密は書かない。デプロイはCIだけ。仕様にない判断は第13節に追記
- 人間が行う作業(Cloudflare の設定など)は docs/setup.md に手順を書く
