-- フェーズ5: 支出に「税金の控除用フラグ」を付ける(医療費控除、セルフメディケーション税制、寄附金控除)
-- 追加のみ。既存の行は NULL(フラグなし)のまま。金額の記録と集計のためで、控除額の判定はしない
ALTER TABLE transactions ADD COLUMN tax_flag TEXT CHECK (tax_flag IS NULL OR tax_flag IN ('medical', 'self_medication', 'donation'));

CREATE INDEX idx_transactions_tax_flag_date ON transactions(tax_flag, date);
