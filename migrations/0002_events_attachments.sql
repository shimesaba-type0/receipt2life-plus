-- フェーズ3: 出来事(日付や期間のメモ)と、写真の添付情報
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT,
  title TEXT NOT NULL,
  note TEXT,
  color TEXT NOT NULL CHECK (color IN ('red', 'orange', 'green', 'blue', 'purple')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_events_start_date ON events(start_date);

-- 写真の実体はR2(フェーズ5)。ここには、どこに紐づくかだけを持つ
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  date TEXT,
  transaction_id TEXT REFERENCES transactions(id),
  event_id TEXT REFERENCES events(id),
  caption TEXT,
  created_at TEXT NOT NULL,
  CHECK (date IS NOT NULL OR transaction_id IS NOT NULL OR event_id IS NOT NULL)
);

CREATE INDEX idx_attachments_transaction_id ON attachments(transaction_id);
CREATE INDEX idx_attachments_event_id ON attachments(event_id);
