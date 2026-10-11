# Web UI 用 API(契約)

Web UI(`ui/`)と、Worker の `/api/*`(`src/api/`)の取り決めです。型は `src/api/contract.ts` が正です(この文書はその説明)。
すべて認証の内側(Cloudflare Access の JWT。`src/auth/access.ts`)。個人用なので、データはユーザーごとに分けません。

## 共通

- 成功: `{"ok": true, ...}`、失敗: `{"ok": false, "errors": [{"index"?, "field", "message"}]}`(`message` は日本語で、直せる具体的な文)
- 検証エラーは HTTP 400、存在しない id は 404、本文が大きすぎるときは 413、認証失敗は 401(Access の前段で止まる場合は UI 側に通信エラーとして見える)
- 日付は `YYYY-MM-DD`、月は `YYYY-MM`、基準は Asia/Tokyo。金額は円の整数
- ロジックは `src/core` の関数を呼ぶ。API にロジックを書かない(MCP と同じ関数を使う)
- 未定義の `/api/*` は、画面(SPA)ではなく 404 の JSON

## 読み取り

| メソッド・パス | 戻り(`ok:true` に続けて) |
| --- | --- |
| `GET /api/home` | `HomeData`: 今日と今月の合計、大分類別(`summarize` の group)、メモ付き支出の割合、要確認の件数、最近の取引5件 |
| `GET /api/calendar?month=YYYY-MM` | `CalendarData`: その月の日別の合計・件数・写真枚数(取引のある日だけ)、その月と重なる出来事。`month` 省略は今月 |
| `GET /api/day/:date` | `DayData`: その日の合計・取引一覧・重なる出来事・写真 |
| `GET /api/categories` | `CategoriesData`: カテゴリ(name, group_name)と口座名 |

## 取引

| メソッド・パス | 入力 | 戻り |
| --- | --- | --- |
| `POST /api/transactions` | `{transactions: NewTransaction[]}`(`add_transactions` と同じ) | `registered`, `skipped_duplicates`, `message` |
| `PATCH /api/transactions/:id` | `TransactionPatch`(`update_transaction` と同じ。null で空にできる) | `transaction`, `warnings`, `message` |
| `DELETE /api/transactions/:id` | なし | `deleted`, `message`(写真が紐づく取引は 400 で拒否) |

## 出来事(日付や期間のメモ)

| メソッド・パス | 入力 | 戻り |
| --- | --- | --- |
| `POST /api/events` | `NewEvent` | `event`, `message` |
| `PATCH /api/events/:id` | `EventPatch` | `event`, `message` |
| `DELETE /api/events/:id` | なし | `deleted`, `message`(紐づく写真があれば 400 で拒否) |

出来事の削除は、MCP には無い(UI 専用)。`core` に `deleteEvent` を足して使う。

## 写真

写真の実体は R2(`PHOTOS`)。**公開しない**。配信は、認証を通した Worker 経由。

| メソッド・パス | 内容 |
| --- | --- |
| `POST /api/photos` | `multipart/form-data`。`file`(必須)と、`date` / `transaction_id` / `event_id` / `caption`(`date`・`transaction_id`・`event_id` のうち1つ以上が必要)。戻り: `photo: PhotoView` |
| `GET /api/photos/:id` | R2 から読んで返す。`Content-Type` は保存時に検証した値、`X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=31536000, immutable`(画像は更新しない) |
| `DELETE /api/photos/:id` | R2 のオブジェクトと、attachments の行を消す |

- 受け付ける画像: JPEG / PNG / WebP。**拡張子や申告の Content-Type を信用せず、先頭のバイト列(マジックナンバー)で判定する**
- サイズ上限: 5MB(ブラウザ側で、長辺1600px程度に縮小してから送る前提。それでも超えたら 413)
- R2 のキー: `photos/<YYYY>/<uuid>`(ファイル名など、利用者の入力をキーに使わない)
- 参照先(取引・出来事)が存在しなければ 400。attachments の行の作成と R2 への保存は、片方だけ残らないようにする(R2 に保存してから行を作り、行の作成に失敗したら R2 を消す)

## エクスポート・インポート

`GET /export`(JSONL)、`POST /import`。docs/backup.md を参照。
