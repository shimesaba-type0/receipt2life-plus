-- カテゴリのアイコン(キーは src/core/category-icons.ts の一覧のどれか。NULL は未設定で、画面では「その他」と同じ見た目)
-- 追加のみ。既存のカテゴリはそのまま
ALTER TABLE categories ADD COLUMN icon TEXT;

-- 初期の5カテゴリだけ、名前が一致する行に既定のアイコンを付ける。名前を変えた行は触らない(NULLのまま)
UPDATE categories SET icon = 'food' WHERE name = '食費';
UPDATE categories SET icon = 'daily' WHERE name = '日用品';
UPDATE categories SET icon = 'transit' WHERE name = '交通・チャージ';
UPDATE categories SET icon = 'entertainment' WHERE name = '娯楽';
UPDATE categories SET icon = 'other' WHERE name = 'その他';
