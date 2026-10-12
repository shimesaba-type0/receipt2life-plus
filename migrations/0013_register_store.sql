-- レシートに印字されたレジ番号(例: 0005)と店番号・店舗コード(例: 007832)を、取引ごとに持つ
-- 追加のみ(列の追加だけ)。既存のテーブルとデータには触れない。任意(NULL可)で、既存の取引は NULL のまま(バックフィルしない)
-- receipt_no(レシート番号・伝票番号)とは別。dedup_hash には含めない。検証と正規化は core(src/core/receipt-details.ts)で行う
ALTER TABLE transactions ADD COLUMN register_no TEXT;
ALTER TABLE transactions ADD COLUMN store_code TEXT;
