import type { ContentUnit } from "../../../src/api/contract";
import { DEFAULT_PER, PER_OPTIONS } from "./productsLogic";

// 単価の表示の単位(100mlあたり・1Lあたりなど)の選択を、このブラウザに覚えておく(端末ごとの好み。無くても動く)
const key = (unit: ContentUnit) => `r2l-unit-per:${unit}`;

export function readPer(unit: ContentUnit | undefined): number | null {
  if (!unit) return null;
  try {
    const raw = Number(localStorage.getItem(key(unit)));
    return PER_OPTIONS[unit].includes(raw) ? raw : DEFAULT_PER[unit];
  } catch {
    return DEFAULT_PER[unit];
  }
}

export function savePer(unit: ContentUnit, per: number): void {
  try {
    localStorage.setItem(key(unit), String(per));
  } catch {
    // 保存できなくても、表示は変えられる
  }
}

// 一覧の見方(商品ごと / まとめ名ごと)も、このブラウザに覚える(URLに指定がないときの既定)
const BY_KEY = "r2l-products-by";
export type ProductsBy = "product" | "group";

export function readBy(): ProductsBy {
  try {
    return localStorage.getItem(BY_KEY) === "group" ? "group" : "product";
  } catch {
    return "product";
  }
}

export function saveBy(by: ProductsBy): void {
  try {
    localStorage.setItem(BY_KEY, by);
  } catch {
    // 保存できなくても、表示は変えられる
  }
}
