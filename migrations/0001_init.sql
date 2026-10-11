-- フェーズ2の最小スキーマ(取引・カテゴリ・口座)。events / attachments はフェーズ3で追加する
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  merchant TEXT,
  category_id TEXT REFERENCES categories(id),
  account_id TEXT REFERENCES accounts(id),
  memo TEXT,
  source TEXT NOT NULL CHECK (source IN ('receipt', 'manual', 'voice')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'needs_review')),
  dedup_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_dedup_hash ON transactions(dedup_hash);

-- 初期データ(暫定。group_name は集計用の大分類)
INSERT INTO categories (id, name, group_name) VALUES
  ('cat_food', '食費', '食費'),
  ('cat_daily', '日用品', '生活'),
  ('cat_transport', '交通・チャージ', '交通'),
  ('cat_leisure', '娯楽', '娯楽'),
  ('cat_other', 'その他', 'その他');

INSERT INTO accounts (id, name) VALUES
  ('acc_cash', '現金'),
  ('acc_card', 'カード'),
  ('acc_suica', 'Suica');
