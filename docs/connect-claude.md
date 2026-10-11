# Claude.ai から receipt2life に繋ぐ(MCP コネクタ)

AI(Claude)から、支出を登録・一覧するための接続手順です。実値(ドメインなど)は、ここには書きません。

## 前提

[setup.md](setup.md) の手順が済んでいること。

- Worker がデプロイされ、カスタムドメインが付いている
- Access で守られていて、ブラウザで `/healthz` を開くと、ログイン後に `{"ok":true}` が出る
- Access アプリの「追加設定」で **Managed OAuth** がオン
- 同じ画面の **許可するリダイレクト URI** に、Claude のコールバックURLが入っている
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`
  - 接続に失敗したときのエラーに、実際のURLが出る。違っていたら、そのURLを足す
- ローカルホスト系の許可(localhost / loopback)は**オフ**

## Claude.ai に追加する

カスタムコネクタの追加は、有料プランの機能です。追加は Web(claude.ai)かデスクトップで行います。一度設定すれば、スマホの Claude アプリからも使えます。

1. claude.ai → プロフィール → 設定 → コネクタ → **カスタムコネクタを追加**
2. 次のとおり入力する。

   | 項目 | 値 |
   | --- | --- |
   | 名前 | `receipt2life` |
   | URL | `https://<サブドメイン>.<ドメイン>/mcp` |
   | 認証 | 今すぐサインイン(検出済み) |
   | OAuth クライアント | 自動的に登録(検出済み) |
   | リクエストヘッダー | 追加しない |

3. 追加して「接続」を押す。Cloudflare Access のログイン画面が開くので、ログインして許可する。
4. チャットの入力欄の「＋」(ツール)メニューで、`receipt2life` をオンにする。

## 動作確認

チャットで、次のように頼みます。

1. 「500円のコーヒーを、現金で、今日付けで登録して」 → 「1件登録しました: …」と返る
2. 「今月の取引を一覧して」

## 使えるツール(12個)

| ツール | 役割 |
| --- | --- |
| `add_transactions` / `list_transactions` / `update_transaction` / `delete_transaction` | 取引の登録・一覧・修正・削除 |
| `summarize` / `list_categories` | 集計、カテゴリと口座の一覧 |
| `add_event` / `update_event` / `list_events` | 日付や期間のメモ(出来事) |
| `create_photo_upload_link` | 写真のアップロード用リンクを作る |
| `list_photos` | 写真のメタ情報(id、日付、紐づけ先、説明、種類、サイズ)の一覧 |
| `get_photos` | 写真の画像そのものを取得する(1回に1〜4枚、合計約6MBまで) |

## 写真を登録・見返す

写真の実体は、チャットからは送れません。登録は「リンクを開いて選ぶ」流れです。

1. チャットで「今日のレシート写真を残したい」「この取引に写真を付けたい」と頼む。
2. AI が `create_photo_upload_link` でリンクを返す(`<オリジン>/photos/add?date=...` など。日付・取引・出来事のどれに紐づけるかが入っている)。
3. リンクを開く。Cloudflare Access のログインを通った、あなた自身のブラウザでだけ開ける(リンクに期限やトークンは付かない)。
4. 画面で写真を選んで追加する。

見返すときは、AI が `list_photos` で写真の id を調べ、`get_photos` で画像を読みます。レシート写真を AI に読み取らせて `add_transactions` で登録する、という使い方もできます。

注意: リンクの先の画面(`/photos/add`)は別のPRで作ります。それまでは、リンクを開いても写真の追加画面は出ません。

## ツールの「常に許可」

チャットでツールを初めて使うとき、実行の許可を求められます。次の3つは、読み取りか無害な操作なので「常に許可」でかまいません。

- `create_photo_upload_link`: リンクを作るだけで、何も保存しない
- `list_photos`: 読み取りだけ
- `get_photos`: 読み取りだけ

`list_transactions` / `list_events` / `list_categories` / `summarize` も読み取りだけです。データを変える・消すもの(`add_transactions`、`update_transaction`、`delete_transaction`、`add_event`、`update_event`)は、内容を見て許可するのがおすすめです。特に `delete_transaction` は取り消せません。

## うまくいかないとき

| 症状 | 見る場所 |
| --- | --- |
| 接続時に、リダイレクトURIの不一致のようなエラー | Access アプリの「許可するリダイレクトURI」に、エラーに出たURLを追加する |
| ログインはできたが、ツールが失敗する | Worker の Observability(ログ)。`auth: ...` の行に、弾いた理由が出る |
| 「ACCESS_... が未設定」 | シークレットを入れた場所が違う。**ランタイム**変数とシークレットに入れる([setup.md](setup.md) の手順4) |
| `claim=aud` | `ACCESS_AUD` が、Access アプリの AUD タグと違う |
| 写真が `get_photos` で見えない | `list_photos` で id を確かめる。合計が約6MBを超えると、超えた分は返らない(返らなかった id で呼び直す) |
| 登録で「テーブルがない」旨のエラー | D1 のマイグレーションが未適用。デプロイコマンドに `d1 migrations apply` が入っているか確認する |

## ChatGPT

未確認(プランや開発者モードの条件による)。確認できたら、ここに追記する。
