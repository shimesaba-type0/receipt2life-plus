// メニューやナビで使う線画(24x24 の path)。DOMに触れない
// カテゴリ(4つの区画)
export const CATEGORY_ICON = ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"];
// 税額(レシートと「%」)
export const TAX_ICON = ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9.5 9.5h.01", "M14.5 14.5h.01", "M14.5 9.5l-5 5"];
// エクスポート・バックアップ(下向きの矢印と受け皿)
export const EXPORT_ICON = ["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"];
// ホーム
export const HOME_ICON = ["M4 11l8-7 8 7", "M6 10v10h12V10"];
// カレンダー
export const CALENDAR_ICON = ["M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M4 10h16M9 3v4M15 3v4"];
// 今日
export const TODAY_ICON = ["M5 5h14v14H5z", "M9 10h6M9 14h4"];
// メニュー(三本線)
export const MENU_ICON = ["M4 7h16", "M4 12h16", "M4 17h16"];

// AIとつなぐ(プラグを差し込む形)
export const CONNECT_ICON = ["M9 3v5", "M15 3v5", "M6 8h12v3a6 6 0 0 1-12 0V8z", "M12 17v4"];

// 割引(値札と「%」)。ホームの「今月の割引」、レシートの値引きの行に使う
export const DISCOUNT_ICON = ["M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z", "M7.5 7.5h.01", "M9.5 15.5l5-5", "M10 11h.01", "M14 15h.01"];
