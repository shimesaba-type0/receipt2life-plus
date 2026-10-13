-- サブスクの外貨払い(ドル・ユーロなど)。追加のみ。既存の行は currency='JPY'(円)のまま変わらない
-- 外貨の行は、外貨の金額(最小単位=セント)と換算レート(1外貨=何円。利用者が決める目安)を持ち、amount(円)はその積の四捨五入で、目安の円。
-- 実際の引き落とし額は、カードの明細の円で、支出(レシート)として別に記録する
ALTER TABLE subscriptions ADD COLUMN currency TEXT NOT NULL DEFAULT 'JPY' CHECK (currency IN ('JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD'));
ALTER TABLE subscriptions ADD COLUMN foreign_amount_minor INTEGER CHECK (foreign_amount_minor IS NULL OR foreign_amount_minor >= 0);
ALTER TABLE subscriptions ADD COLUMN exchange_rate REAL CHECK (exchange_rate IS NULL OR exchange_rate > 0);
-- 外貨の金額を変えたとき、直前の外貨の金額(最小単位)
ALTER TABLE subscriptions ADD COLUMN previous_foreign_minor INTEGER;
