-- JSONL のバックアップを書き出した日時の記録(1回の書き出しにつき1行)。ホームの「バックアップのお知らせ」に使う
-- 追加のみ。既存のテーブルとデータには触れない
CREATE TABLE backup_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
