-- 検索画面の「よく使う検索」のチップ。ラベル(表示名)と、探す言葉・対象の組。画面から足したり消したりできる
-- 追加のみ。既存のテーブルとデータには触れない
CREATE TABLE search_chips (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 20),
  q TEXT NOT NULL DEFAULT '' CHECK (length(q) <= 200),
  type TEXT CHECK (type IS NULL OR type IN ('transaction', 'event', 'seat_record', 'link', 'photo')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (q <> '' OR type IS NOT NULL)
);
