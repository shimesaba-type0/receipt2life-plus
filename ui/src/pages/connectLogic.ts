// AIとつなぐ画面の純粋な部分(DOMに触れない。テストする)

// MCP サーバーのURL。いま開いているアドレス(origin)に /mcp を付けたもの。末尾の / や /mcp が付いていても重ならない
export function mcpUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/mcp`;
}

// コネクタに入れる項目(Claude.ai のカスタムコネクタ)
export function connectorFields(origin: string): { label: string; value: string }[] {
  return [
    { label: "名前", value: "Receipt to Life +" },
    { label: "URL", value: mcpUrl(origin) },
    { label: "認証", value: "今すぐサインイン(自動で検出される)" },
    { label: "リクエストヘッダー", value: "追加しない" },
  ];
}

// 動作確認に頼む文
export const TRY_PROMPTS = ["500円のコーヒーを、現金で、今日付けで登録して", "今月の取引を一覧して", "今月のカテゴリ別の支出を教えて"] as const;
