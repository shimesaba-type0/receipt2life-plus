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
