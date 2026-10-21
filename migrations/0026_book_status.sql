-- 本の記録に「手元の状況」(status)と、手放した日(released_on)を足す
-- 手元にある(owned)・売った(sold)・譲った・贈った(given)・寄贈した(donated)・なくした(lost)・処分した(discarded)
-- 追加のみ。既存の行は、手元にある(owned)になる。売った金額は記録しない(メモに書く)
ALTER TABLE books ADD COLUMN status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned', 'sold', 'given', 'donated', 'lost', 'discarded'));
ALTER TABLE books ADD COLUMN released_on TEXT CHECK (released_on IS NULL OR released_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
