-- レシートに印字された税率と税額を、印字どおりに記録する(こちらで税額を計算して補わない。税率の表も持たない)
-- 追加のみ。既存のテーブルとデータには触れない(既存の明細・取引は NULL / 内訳なしのまま。バックフィルしない)
-- 税金の控除用フラグ(tax_flag。医療費控除など)とは別物

-- 明細の行ごとの税率(%。0〜100、小数可。NULL=不明)と、印字どおりの記号(「※」「軽」など。20文字まで)
ALTER TABLE transaction_items ADD COLUMN tax_rate REAL CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100));
ALTER TABLE transaction_items ADD COLUMN tax_label TEXT CHECK (tax_label IS NULL OR length(tax_label) <= 20);

-- レシート下部の税率別の内訳(「10%対象 ¥1,100 消費税 ¥100」など)。1取引につき税率ごとに1行
-- taxable_amount=その税率の対象金額(円)、tax_amount=その税率の消費税額(円)。どちらも印字が無ければ NULL
-- amount_basis=対象金額が税込(included)か税抜(excluded)か。印字から分かる場合だけ
CREATE TABLE transaction_tax_lines (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  rate REAL NOT NULL CHECK (rate >= 0 AND rate <= 100),
  taxable_amount INTEGER,
  tax_amount INTEGER,
  amount_basis TEXT CHECK (amount_basis IS NULL OR amount_basis IN ('included', 'excluded')),
  label TEXT CHECK (label IS NULL OR length(label) <= 20),
  created_at TEXT NOT NULL,
  UNIQUE (transaction_id, rate)
);

CREATE INDEX idx_transaction_tax_lines_transaction ON transaction_tax_lines(transaction_id);
