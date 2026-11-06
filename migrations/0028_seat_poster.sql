-- 座席の記録にポスター画像のURL(poster_url)を足す。任意。画像そのものは保存せず、https のURLを参照するだけ
-- 追加のみ。既存の行は NULL のまま
ALTER TABLE seat_records ADD COLUMN poster_url TEXT CHECK (poster_url IS NULL OR (length(poster_url) <= 500 AND poster_url LIKE 'https://%'));
