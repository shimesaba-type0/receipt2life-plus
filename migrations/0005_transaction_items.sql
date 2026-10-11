-- フェーズ5: レシートの明細(行)。1つの取引(レシート)の下に、品名・金額の行を持つ
-- 追加のみ。既存のテーブルとデータには触れない(既存の取引は明細なしのまま。バックフィルしない)
-- 取引の amount が支払総額の正。明細がある取引は、明細の amount の合計 = 取引の amount(core で検証する)
-- 行の実効カテゴリ・実効税金フラグは COALESCE(行の値, 取引の値)。値引きはマイナスの行(0円は不可)
CREATE TABLE transaction_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount != 0),
  category_id TEXT REFERENCES categories(id),
  tax_flag TEXT CHECK (tax_flag IS NULL OR tax_flag IN ('medical', 'self_medication', 'donation')),
  memo TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_transaction_items_transaction_position ON transaction_items(transaction_id, position);
