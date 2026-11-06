-- 座席の記録に、作品の評価(work_rating)を足す。rating(席の評価)とは別。任意の1〜5の整数
-- 追加のみ。既存の行は NULL のまま
ALTER TABLE seat_records ADD COLUMN work_rating INTEGER CHECK (work_rating IS NULL OR (work_rating BETWEEN 1 AND 5));
