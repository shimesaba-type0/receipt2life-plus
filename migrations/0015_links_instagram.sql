-- リンクの種類に instagram を足す(Instagram の投稿・リール・プロフィール)
-- SQLite は CHECK 制約を直接は変えられないので、テーブルを作り直す。行はそのまま移す。links を参照するテーブルは無い
CREATE TABLE links_new (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('x', 'youtube', 'instagram')),
  title TEXT,
  date TEXT CHECK (date IS NULL OR date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  transaction_id TEXT REFERENCES transactions(id),
  event_id TEXT REFERENCES events(id),
  created_at TEXT NOT NULL,
  CHECK (date IS NOT NULL OR transaction_id IS NOT NULL OR event_id IS NOT NULL)
);

INSERT INTO links_new (id, url, kind, title, date, transaction_id, event_id, created_at)
  SELECT id, url, kind, title, date, transaction_id, event_id, created_at FROM links;

DROP TABLE links;
ALTER TABLE links_new RENAME TO links;

CREATE INDEX idx_links_date ON links(date);
CREATE INDEX idx_links_transaction_id ON links(transaction_id);
CREATE INDEX idx_links_event_id ON links(event_id);
