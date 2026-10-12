// https のURLを検証して、正規化する(フラグメントを消す)。外のサイトには取りに行かない
// 使えないもの: https 以外、空白・制御文字・ASCII以外、user:pass@、ポート番号
export function parseHttpsUrl(input: string): string | null {
  const raw = input.trim();
  if (raw === "" || raw.length > 2048) return null;
  if (/[^\x21-\x7e]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.port !== "") return null;
  u.hash = "";
  return u.toString();
}
