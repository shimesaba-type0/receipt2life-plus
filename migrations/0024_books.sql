-- 買った本の記録(books): ISBN、タイトル、著者、シリーズ名、購入者、メモを残し、あとから絞り込めるようにする
-- 追加のみ。既存のテーブルとデータには触れない。取引(レシート)への紐づけは任意
-- 取引が消えたときは、本の記録は残して transaction_id だけ NULL にする(ON DELETE SET NULL)
-- purchased_on(買った日)が無くて取引に紐づいていれば、その取引の日付を買った日として扱う
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  isbn TEXT CHECK (isbn IS NULL OR length(isbn) = 13),
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200),
  author TEXT CHECK (author IS NULL OR length(author) BETWEEN 1 AND 100),
  series TEXT CHECK (series IS NULL OR length(series) BETWEEN 1 AND 100),
  buyer TEXT CHECK (buyer IS NULL OR length(buyer) BETWEEN 1 AND 50),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  purchased_on TEXT CHECK (purchased_on IS NULL OR purchased_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (isbn IS NOT NULL OR title IS NOT NULL)
);

CREATE INDEX idx_books_isbn ON books(isbn);
CREATE INDEX idx_books_series ON books(series);
CREATE INDEX idx_books_transaction_id ON books(transaction_id);
