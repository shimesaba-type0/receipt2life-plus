// Vite の ?raw インポート(テストで sw.js の中身を文字列で読む)
declare module "*?raw" {
  const content: string;
  export default content;
}
