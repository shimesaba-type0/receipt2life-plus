import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCategoryTools } from "./tools/categories";
import { registerEventTools } from "./tools/events";
import { registerLinkTools } from "./tools/links";
import { registerPhotoTools } from "./tools/photos";
import { registerReportTools } from "./tools/reports";
import { registerTransactionTools } from "./tools/transactions";

// origin は MCP リクエストのURLのオリジン(アップロード用リンクの組み立てに使う)
export function createMcpServer(db: D1Database, bucket: R2Bucket, origin: string): McpServer {
  const server = new McpServer({ name: "receipt2life", version: "0.1.0" });
  registerTransactionTools(server, db);
  registerCategoryTools(server, db);
  registerEventTools(server, db);
  registerReportTools(server, db);
  registerPhotoTools(server, db, bucket, origin);
  registerLinkTools(server, db);
  return server;
}
