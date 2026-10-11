import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// MCPのハンドラーは、核(core)の関数を呼んで結果を包むだけ。ロジックはここに書かない
export function toResult(result: { ok: boolean }): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result) }], ...(result.ok ? {} : { isError: true }) };
}
