-- 本の記録にカバー画像のURL(cover_url)を足す。任意。画像そのものは保存せず、https のURLを参照するだけ
-- 追加のみ。既存の行は NULL のまま
ALTER TABLE books ADD COLUMN cover_url TEXT CHECK (cover_url IS NULL OR (length(cover_url) <= 500 AND cover_url LIKE 'https://%'));
