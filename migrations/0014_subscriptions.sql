-- サブスク・保険などの固定費の登録(別枠。支出の記録=transactions とは独立で、二重に数えない)
-- 追加のみ。既存のテーブルとデータには触れない
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- subscription=サブスク / insurance=保険 / other=その他の固定費
  kind TEXT NOT NULL DEFAULT 'subscription' CHECK (kind IN ('subscription', 'insurance', 'other')),
  -- 1回の支払い額(円)。period が monthly なら月額、yearly なら年額
  amount INTEGER NOT NULL CHECK (amount >= 0),
  period TEXT NOT NULL CHECK (period IN ('monthly', 'yearly')),
  -- 支払う月(1〜12。年払いの更新月)と日(1〜31)。どちらも任意
  billing_month INTEGER CHECK (billing_month IS NULL OR (billing_month >= 1 AND billing_month <= 12)),
  billing_day INTEGER CHECK (billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 31)),
  -- 金額が変わったとき、直前の金額と変えた日(値上がり・値下がりの表示用)
  previous_amount INTEGER,
  amount_changed_on TEXT,
  -- 金額を最後に確認した日(AI に調べてもらって、変わっていなかったときも更新できる)
  price_checked_on TEXT,
  url TEXT,
  note TEXT,
  -- 1=契約中、0=解約済み(記録は残す。合計には入れない)
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_subscriptions_active ON subscriptions(active);
