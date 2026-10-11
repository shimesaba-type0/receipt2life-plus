-- フェーズ5: レシートから読み取れる情報(決済時刻・店の連絡先・登録番号など)を、取引ごとに持つ
-- 追加のみ(列の追加だけ)。既存のテーブルとデータには触れない。すべて任意(NULL可)で、既存の取引は NULL のまま(バックフィルしない)
-- paid_time は日本時間の HH:MM(日付は既存の date)。検証と正規化は core(src/core/receipt-details.ts)で行う
ALTER TABLE transactions ADD COLUMN paid_time TEXT;
ALTER TABLE transactions ADD COLUMN merchant_phone TEXT;
ALTER TABLE transactions ADD COLUMN merchant_address TEXT;
ALTER TABLE transactions ADD COLUMN invoice_number TEXT;
ALTER TABLE transactions ADD COLUMN clerk_name TEXT;
ALTER TABLE transactions ADD COLUMN receipt_no TEXT;
