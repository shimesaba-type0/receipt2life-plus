-- 商品の「まとめ名」。表記ゆれや、似た商品(牛乳・低脂肪乳・ミルク)を1つにくくって集計するための、利用者が決める分け方
-- まとめ名(name)と、それに含める言葉(product_group_words)。商品の名前にその言葉が含まれていれば、そのまとめに入る
-- 元の明細は変えない(集計のときだけ、くくって見る)。追加のみ
CREATE TABLE product_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 30),
  created_at TEXT NOT NULL
);

CREATE TABLE product_group_words (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  word TEXT NOT NULL CHECK (length(word) BETWEEN 1 AND 30),
  created_at TEXT NOT NULL,
  UNIQUE (group_id, word)
);

CREATE INDEX idx_product_group_words_group ON product_group_words(group_id);
