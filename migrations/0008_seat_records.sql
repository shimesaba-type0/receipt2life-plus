-- 座席の記録(seat_records): 映画館のスクリーン・座席など、会場の席の評価を構造化して残す
-- 追加のみ。既存のテーブルとデータには触れない。取引の列は増やさず、別の小さな記録として持つ
-- venue=会場、screen=スクリーン/ホール、seat=座席。作品名は持たない(取引の明細に入っているため)
-- 取引が消えたときは、座席の記録は残して transaction_id だけ NULL にする(ON DELETE SET NULL)
CREATE TABLE seat_records (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  venue TEXT NOT NULL,
  screen TEXT,
  seat TEXT NOT NULL,
  rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  note TEXT,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_seat_records_venue_date ON seat_records(venue, date);
CREATE INDEX idx_seat_records_date ON seat_records(date);
CREATE INDEX idx_seat_records_transaction_id ON seat_records(transaction_id);
