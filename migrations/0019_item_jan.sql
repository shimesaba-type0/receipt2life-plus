-- 明細(transaction_items)に、JANコード(商品のバーコード。8桁か13桁)を足す(追加のみ。既存の行は NULL)
-- 同じJANの商品は、品名の表記が違っても同じ商品として集計する。チェックデジットの検証は core で行う
ALTER TABLE transaction_items ADD COLUMN jan_code TEXT CHECK (jan_code IS NULL OR (length(jan_code) IN (8, 13) AND jan_code NOT GLOB '*[^0-9]*'));
