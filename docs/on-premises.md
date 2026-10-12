# 自宅サーバー(オンプレ)で動かす調査メモ

「自宅サーバー + Cloudflare Tunnel + Cloudflare Access で、このアプリを再現できるか」の調査結果です。
実値(ドメイン、ID、メールなど)は書きません。`<サブドメイン>.<ドメイン>` や `<チーム名>` は、自分の値に読み替えてください。

**このセッションでは実機で動かしていません。** 公式ドキュメント(2026年10月時点)とこのリポジトリのコードを読んだ結果で、動作は「未検証」です。

## 1. 結論

- **できる見込みが高い。オブジェクトストレージ(MinIO など)は要らない。** `wrangler dev` は D1 をローカルの SQLite、R2 をローカルのディスクに保存する(既定は `.wrangler/state`、`--persist-to <ディレクトリ>` で場所を変えられる)。このアプリの `DB`(D1)と `PHOTOS`(R2)は、そのまま動くはず(未検証)
- Web UI は `ui/dist` を `npm run build` で作れば、Assets として配信される(未検証)
- 認証は、Tunnel の先で動く Worker が今と同じように Access の JWT を検証する。コードの変更は要らない見込み(`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` を渡すだけ)
- **ただし本番用途としては保証されない。** `wrangler dev`(Miniflare / workerd)は開発用のシミュレーターで、運用の SLA もサポートも無い。家計・ライフログのデータを置くので、バックアップ(第5節)を必ず取ること
- 推奨: 構成案A(`wrangler dev` + `cloudflared` + Access)。非推奨: 構成案B(認証なし)

## 2. Cloudflare への依存と、オンプレでの代わり

| 依存 | 今(Cloudflare) | オンプレでの再現 |
| --- | --- | --- |
| `DB` | D1 | `wrangler dev` のローカル D1(SQLite のファイル)。`migrations/` は `wrangler d1 migrations apply DB --local --persist-to <ディレクトリ>` で当てる |
| `PHOTOS` | R2 | `wrangler dev` のローカル R2。実体はディスク上のファイル。S3 互換のサーバーは不要 |
| `ASSETS` | Workers Assets(`ui/dist`) | 同じ設定のまま。`ui/dist` を先にビルドしておく |
| Access の JWT | Access アプリ(Worker 用) | 公開側の入口を Tunnel にし、Tunnel のホスト名を Access の「セルフホスト」アプリで守る。Worker は `Cf-Access-Jwt-Assertion` を `https://<チーム名>.cloudflareaccess.com/cdn-cgi/access/certs` の鍵で検証する(今と同じ) |
| Observability | ダッシュボードのログ | 使えない。ログは `wrangler dev` の標準出力(systemd なら journald)で見る |

メモ:

- ローカルデータは D1・R2 とも `.wrangler/state` 配下(`--persist-to` を指定した場合はそのディレクトリ)に保存される。再起動してもデータは残る。ただし `--persist-to` は **`wrangler dev` と、`--local` を付けた他の wrangler コマンドの両方に同じ値を渡す**必要がある(公式ドキュメント)
- 本番の Cloudflare 側の D1・R2 とは別物。データは自動では同期されない。移すときは `/export` と `/import`(docs/backup.md)を使う。写真は JSONL に含まれないので、別に移す必要がある(要確認: ローカル R2 へ一括で入れる手順。`wrangler r2 object put <バケット>/<キー> --file=<ファイル> --local` は公式にあるが、キーの付け方はこのアプリのコード次第で、ここでは未調査)
- `wrangler.toml` の `database_id` は書いていない。ローカルでは不要の見込み(未検証)

## 3. 構成案A: `wrangler dev` + Tunnel + Access(推奨候補)

```
ブラウザ → Cloudflare(Access で認証)→ Tunnel(cloudflared が外向きに接続)→ 自宅サーバーの 127.0.0.1:8787(wrangler dev)
```

自宅のルーターのポート開放は要りません(`cloudflared` は外向きの接続だけを張る。公式ドキュメント)。

### 手順

1. 自宅サーバーに Node.js と、このリポジトリを用意する(`git clone` → `npm ci`)
2. UI をビルドする: `npm run build`(`ui/dist` ができる)
3. DB を作る(永続化ディレクトリはリポジトリの外に置く。例: `/var/lib/receipt2life`):
   `npx wrangler d1 migrations apply DB --local --persist-to /var/lib/receipt2life`
4. `.dev.vars`(gitignore 済み。コミットしない)に、次の2つだけを書く。**`AUTH_BYPASS` は書かない**:
   ```
   ACCESS_TEAM_DOMAIN=<チーム名>.cloudflareaccess.com
   ACCESS_AUD=<AUDタグ>
   ```
   (AUD タグは次の手順 6 のあとに分かる。それまでは未設定のままにする。未設定なら全リクエストを拒否する=フェイルクローズ)
5. Tunnel を作る(Zero Trust → Networks → Connectors → Cloudflare Tunnel。画面の名前は変わりやすい)。`cloudflared` を自宅サーバーに入れ、発行されたトークンで起動する。公開ホスト名に `<サブドメイン>.<ドメイン>`、サービスに `http://127.0.0.1:8787` を設定する(ドメインは Cloudflare で管理していること)
6. Access のアプリを作る: Zero Trust → Access controls → アプリケーション → 追加 → **セルフホスト**(Web アプリ)→ 上のホスト名を指定。ポリシーは Allow、Include は自分のメールアドレスだけ。アプリの設定にある **Application Audience (AUD) Tag** を手順 4 の `ACCESS_AUD` に入れる。`<チーム名>.cloudflareaccess.com` が `ACCESS_TEAM_DOMAIN`(docs/setup.md の「3. Access で守る」と同じ考え方。Worker 用ではなくセルフホストのアプリを使う点だけが違う。要確認: 画面の項目名)
7. 起動する:
   `npx wrangler dev --ip 127.0.0.1 --port 8787 --persist-to /var/lib/receipt2life`
   - `--ip` / `--port` は公式ドキュメントにあるオプション。**127.0.0.1 にだけバインドし、Tunnel 以外から直接届かないようにする**(LAN のほかの端末からも見えない)。ファイアウォールでも 8787 を開けない
8. ブラウザで `https://<サブドメイン>.<ドメイン>/` を開き、Access のログイン → 画面が出るか確認する。MCP / curl などブラウザ以外のクライアントを使うときは、docs/connect-claude.md と同じく Access 側の設定(サービストークンなど)が別に要る(未検証)

### 守ること

- **`AUTH_BYPASS` を、公開側・Tunnel の先のプロセスには絶対に設定しない。** コードは `AUTH_BYPASS=1` かつリクエストのホストが localhost のときだけ素通りにする(`src/auth/access.ts`)。Tunnel 経由のホストは公開ホスト名なので通常は効かないが、`cloudflared` の設定でホストヘッダーを localhost に書き換えると、素通りが効いてしまう可能性がある(未検証)。そもそも置かないのが一番安全
- `.dev.vars`、永続化ディレクトリ、`/export` のファイルは実データか秘密。リポジトリに置かない・コミットしない
- Access のポリシーは、自分のメールアドレスだけにする(実値はドキュメントに書かない)

## 4. 構成案B: Tunnel も Access も使わず LAN 内だけ(非推奨)

`wrangler dev` を LAN に向けて開け、`AUTH_BYPASS=1` で使う案です。**非推奨。**

- `AUTH_BYPASS` はリクエストのホストが localhost のときだけ効く。LAN のアドレスや名前(例: `192.168.x.x`)でアクセスすると素通りにならず、全リクエストが 401 になる。使うには `localhost` で開く必要があり、実質、サーバー本体のブラウザからしか使えない(スマホからは使えない)
- ホスト判定を緩めるコード変更は、認証を弱めるのでやらない
- `--ip 0.0.0.0` で LAN に開けると、LAN 内の誰でも・ゲスト Wi-Fi の端末でも、認証なしに近い状態で届く恐れがある。家計の実データがあるので避ける
- 結論: 認証付きの案Aを使う。ホストだけで使うなら、127.0.0.1 バインド + `AUTH_BYPASS=1`(開発と同じ)はありえるが、他端末からは使えない

## 5. 運用

### バックアップ

- `https://<サブドメイン>.<ドメイン>/export`(JSONL)を定期的に保存する。形式と復元は [backup.md](backup.md)
- **写真は JSONL に含まれない**(docs/backup.md)。永続化ディレクトリ(例: `/var/lib/receipt2life`)の R2 の部分をコピーして残す
- 永続化ディレクトリ全体のコピーも取る。SQLite を動かしたままコピーすると壊れた状態で取れることがあるので、止めてから、またはスナップショット(LVM、ZFS など)で取る(要確認: D1 ローカルの SQLite の安全なコピー方法)
- バックアップ先は自宅の外にも1つ(実データなので暗号化する。方法は各自)

### アップデート

1. `git pull`
2. `npm ci`
3. `npm run build`
4. `npx wrangler d1 migrations apply DB --local --persist-to /var/lib/receipt2life`
5. サービスを再起動する

適用前に、第5節の方法でバックアップを取る。

### 常駐(systemd の例。値はプレースホルダー)

```ini
[Unit]
Description=Receipt to Life + (wrangler dev)
After=network-online.target

[Service]
User=<実行ユーザー>
WorkingDirectory=/opt/receipt2life-plus
ExecStart=/usr/bin/npx wrangler dev --ip 127.0.0.1 --port 8787 --persist-to /var/lib/receipt2life
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`cloudflared` は公式のパッケージの `cloudflared service install <トークン>` で常駐できる(トークンは秘密。ファイルや履歴に残さない)。Docker で動かす場合も同じ考え方で、`/var/lib/receipt2life` をボリュームにし、ポートは `127.0.0.1:8787:8787` のようにローカルだけに公開する(Dockerfile は用意していない。未検証)。

## 6. 制限・注意

- `wrangler dev` は開発用。本番運用は想定外で、サポート対象外。更新で挙動が変わる可能性がある(`package.json` の wrangler のバージョンを固定して上げる)
- workerd 単体(wrangler を使わない)で動かす案は、D1・R2・Assets のバインディングを自前で設定する必要があり、未調査。ここでは勧めない
- 再起動時: 永続化ディレクトリがあればデータは残る。`--persist-to` を付け忘れる・別のディレクトリで起動すると、空のデータで始まったように見える(`.wrangler/state` が使われる)。必ず同じ値を使う
- 開発サーバー特有の挙動(ライブリロードのための監視など)がある。ソースを触らなければ影響は小さいはずだが、未検証
- 可用性: 自宅回線・電源・サーバーが止まれば、アプリも止まる。外出先から使えない時間ができる。UPS、自動再起動、`cloudflared` の常駐監視は各自で
- Access の無料枠: Zero Trust の Free プランがある(公式)。無料で使えるユーザー数の上限は、この調査で公式ドキュメントから確認できなかったため **要確認**(Cloudflare の Zero Trust 料金ページで確認する)。自分ひとりなら足りる見込み
- Tunnel の使い方・料金・制限も、公式ドキュメントで最新を確認してから導入する
- Cloudflare の外で動かすので、Cloudflare 側の本番(Worker・D1・R2)とは別の環境になる。両方を同時に運用するときは、データの二重管理に注意する

## 未検証の一覧

- 実機での起動(`wrangler dev` で D1・R2・Assets・認証がすべて動くか)
- Tunnel 経由で `Cf-Access-Jwt-Assertion` が Worker に届くか、`request.url` のホストが公開ホスト名になるか
- セルフホストの Access アプリの画面の項目名と、AUD タグの場所
- 写真(R2)のローカルへの一括移行手順
- ローカル SQLite の安全なバックアップ方法
- Docker 化、workerd 単体での運用
- Access 無料枠のユーザー数の上限
