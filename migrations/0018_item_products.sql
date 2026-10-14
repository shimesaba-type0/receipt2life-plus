-- 明細(transaction_items)に、商品の情報を足す(追加のみ。既存の行は変わらず、すべて NULL)
-- product: 統一した商品名(「牛乳」「卵」など。AI が付ける)。商品ごとの購入数・単価の推移の集計のキー。NULL なら品名(name)で集計する
-- quantity: 買った数(2パック買ったら 2)。NULL は 1 として数える
-- content_amount / content_unit: 1つあたりの内容量(例: 1000 と ml、10 と 個)。単位は g / ml / 個 のどれか。2つはセット(両方あるか、両方 NULL)
-- 単価は、行の金額 ÷ (買った数 × 内容量)で、保存せずに計算する
ALTER TABLE transaction_items ADD COLUMN product TEXT;
ALTER TABLE transaction_items ADD COLUMN quantity REAL CHECK (quantity IS NULL OR quantity > 0);
ALTER TABLE transaction_items ADD COLUMN content_amount REAL CHECK (content_amount IS NULL OR content_amount > 0);
ALTER TABLE transaction_items ADD COLUMN content_unit TEXT CHECK (content_unit IS NULL OR content_unit IN ('g', 'ml', '個'));
