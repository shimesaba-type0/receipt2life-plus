-- 商品の集計に入れない言葉(商品の一覧・履歴から外す行の名前に含まれる言葉)。画面から追加・削除できる
-- 追加のみ。既存のテーブルとデータには触れない。最初は、消費税・割引・クーポンなど、商品ではない行の言葉を入れておく
CREATE TABLE product_excludes (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL UNIQUE CHECK (length(word) BETWEEN 1 AND 30),
  created_at TEXT NOT NULL
);

INSERT INTO product_excludes (id, word, created_at) VALUES
  ('pex_tax', '消費税', '2026-10-14T00:00:00.000Z'),
  ('pex_tax_in', '内税', '2026-10-14T00:00:00.000Z'),
  ('pex_tax_out', '外税', '2026-10-14T00:00:00.000Z'),
  ('pex_tax_amount', '税額', '2026-10-14T00:00:00.000Z'),
  ('pex_tax_etc', '税等', '2026-10-14T00:00:00.000Z'),
  ('pex_discount', '割引', '2026-10-14T00:00:00.000Z'),
  ('pex_markdown', '値引', '2026-10-14T00:00:00.000Z'),
  ('pex_markdown2', '値下', '2026-10-14T00:00:00.000Z'),
  ('pex_coupon', 'クーポン', '2026-10-14T00:00:00.000Z');
