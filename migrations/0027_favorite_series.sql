-- 本のお気に入りシリーズ。シリーズ名(books.series と同じ文字)を持つだけの小さな表
-- 追加のみ。既存のテーブルとデータには触れない
CREATE TABLE favorite_series (
  series TEXT PRIMARY KEY CHECK (length(series) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL
);
