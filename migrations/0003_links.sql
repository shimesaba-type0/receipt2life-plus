-- フェーズ5: 出来事・取引・日付に付ける外部リンク(Xの投稿、YouTubeの動画)
-- 追加のみ。既存のテーブルとデータには触れない。タイトル取得や埋め込みはしない(URLと任意のタイトルだけ持つ)
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('x', 'youtube')),
  title TEXT,
  date TEXT CHECK (date IS NULL OR date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  transaction_id TEXT REFERENCES transactions(id),
  event_id TEXT REFERENCES events(id),
  created_at TEXT NOT NULL,
  CHECK (date IS NOT NULL OR transaction_id IS NOT NULL OR event_id IS NOT NULL)
);

CREATE INDEX idx_links_date ON links(date);
CREATE INDEX idx_links_transaction_id ON links(transaction_id);
CREATE INDEX idx_links_event_id ON links(event_id);
