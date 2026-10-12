-- 座席の記録に席種(seat_class)を足す(プレミアムシート、内野指定席、ボックスシートなど)。任意
-- 追加のみ。既存の行は NULL のまま(バックフィルしない)。席種は文字列で持つ(会場ごとの席種テーブルは使ってみて必要になったら検討)
ALTER TABLE seat_records ADD COLUMN seat_class TEXT;
