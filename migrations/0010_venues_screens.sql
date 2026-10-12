-- 会場(venues)とスクリーン(screens)を、座席の記録(seat_records)から別のレコードに分ける
-- 理由: 会場名・スクリーン名の表記ゆれを防ぐことと、スクリーンごとの情報(note=そのスクリーンの特徴)を持つため
-- seat_records の venue / screen(文字列)は、venue_id(NOT NULL)/ screen_id(NULL可)に置き換える。
-- SQLite/D1 は列の付け替えが面倒なので、新しいテーブルを作り、データを移し、旧テーブルを DROP して RENAME する。
-- 既存データは失わない: 会場名は重複を1件にまとめて venues へ、(会場, スクリーン)の組は screens へ移す。screen が空(NULL・空白だけ)の記録は screen_id = NULL。
-- seat_records を参照するテーブルはないので、DROP しても外部キーに触れない。transaction_id は ON DELETE SET NULL を引き継ぐ。
-- id はこの SQL の中で採番する(randomblob による32桁の16進。アプリの UUID とは形が違うが、id は不透明な文字列として扱う)。
CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE screens (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (venue_id, name)
);

CREATE INDEX idx_screens_venue_id ON screens(venue_id);

-- 会場: 前後の空白を除いた名前ごとに1件(いちばん古い記録の日時を作成日時にする)
INSERT INTO venues (id, name, created_at)
SELECT lower(hex(randomblob(16))), TRIM(venue), MIN(created_at)
FROM seat_records
GROUP BY TRIM(venue);

-- スクリーン: (会場, スクリーン名)ごとに1件。空のスクリーンは作らない。note は NULL
INSERT INTO screens (id, venue_id, name, note, created_at)
SELECT lower(hex(randomblob(16))), v.id, TRIM(r.screen), NULL, MIN(r.created_at)
FROM seat_records r
JOIN venues v ON v.name = TRIM(r.venue)
WHERE r.screen IS NOT NULL AND TRIM(r.screen) != ''
GROUP BY v.id, TRIM(r.screen);

CREATE TABLE seat_records_new (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  title TEXT,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  screen_id TEXT REFERENCES screens(id),
  seat TEXT NOT NULL,
  rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  note TEXT,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

INSERT INTO seat_records_new (id, date, title, venue_id, screen_id, seat, rating, note, transaction_id, created_at)
SELECT r.id, r.date, r.title, v.id, s.id, r.seat, r.rating, r.note, r.transaction_id, r.created_at
FROM seat_records r
JOIN venues v ON v.name = TRIM(r.venue)
LEFT JOIN screens s ON s.venue_id = v.id AND s.name = TRIM(r.screen);

DROP TABLE seat_records;
ALTER TABLE seat_records_new RENAME TO seat_records;

CREATE INDEX idx_seat_records_venue_date ON seat_records(venue_id, date);
CREATE INDEX idx_seat_records_screen_id ON seat_records(screen_id);
CREATE INDEX idx_seat_records_date ON seat_records(date);
CREATE INDEX idx_seat_records_transaction_id ON seat_records(transaction_id);
