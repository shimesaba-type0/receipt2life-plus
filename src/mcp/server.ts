import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "./tools/accounts";
import { registerCategoryTools } from "./tools/categories";
import { registerEventTools } from "./tools/events";
import { registerLinkTools } from "./tools/links";
import { registerPhotoTools } from "./tools/photos";
import { registerReportTools } from "./tools/reports";
import { registerSeatRecordTools } from "./tools/seat-records";
import { registerSubscriptionTools } from "./tools/subscriptions";
import { registerTransactionTools } from "./tools/transactions";

// origin は MCP リクエストのURLのオリジン(アップロード用リンクの組み立てに使う)
export function createMcpServer(db: D1Database, bucket: R2Bucket, origin: string): McpServer {
  const server = new McpServer({ name: "receipt2life", title: "Receipt to Life +", version: "0.1.0" });
  registerTransactionTools(server, db, bucket, origin);
  registerCategoryTools(server, db);
  registerAccountTools(server, db);
  registerEventTools(server, db);
  registerReportTools(server, db);
  registerPhotoTools(server, db, bucket, origin);
  registerLinkTools(server, db);
  registerSeatRecordTools(server, db);
  registerSubscriptionTools(server, db);
  return server;
}
