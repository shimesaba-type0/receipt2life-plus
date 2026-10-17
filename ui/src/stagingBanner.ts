// ステージングの目印の帯(「STAGING・PR #番号」)の文言。ビルド時の変数 VITE_STAGING_LABEL から作る
// 本番のビルドには、この変数を渡さない(.github/workflows/ci.yml の deploy-staging だけが渡す)ので、本番には出ない

const MAX = 60;

/** 帯の文言。変数が無い・空・文字列でなければ null(帯を出さない)。長すぎる文言は切る */
export function stagingLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return null;
  return Array.from(text).slice(0, MAX).join("");
}
