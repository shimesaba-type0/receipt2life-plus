-- 座席の記録に作品名・公演名(title)を足す(映画のタイトル、ライブ名など)。任意
-- 追加のみ。既存の行は NULL のまま(バックフィルしない)。0008 の「作品名は持たない」を改める
ALTER TABLE seat_records ADD COLUMN title TEXT;
