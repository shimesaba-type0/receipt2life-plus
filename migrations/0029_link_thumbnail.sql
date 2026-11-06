-- リンクにサムネイル画像のURL(thumbnail_url)を足す。任意。ウェブのページの OGP(og:image)から取ったURLを、画像は保存せず参照するだけ
-- 追加のみ。既存の行は NULL のまま(YouTube のサムネイルは、動画のIDから画面が作るので、ここには入れない)
ALTER TABLE links ADD COLUMN thumbnail_url TEXT CHECK (thumbnail_url IS NULL OR (length(thumbnail_url) <= 500 AND thumbnail_url LIKE 'https://%'));
