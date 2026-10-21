import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TitleFetcher } from "../core/link-titles";
import { registerAccountTools } from "./tools/accounts";
import { registerCategoryTools } from "./tools/categories";
import { registerCompareTools } from "./tools/compare";
import { registerEventTools } from "./tools/events";
import { registerLinkTools } from "./tools/links";
import { registerMerchantTools } from "./tools/merchants";
import { registerPhotoTools } from "./tools/photos";
import { registerProductTools } from "./tools/products";
import { registerReportTools } from "./tools/reports";
import { registerSearchTools } from "./tools/search";
import { registerBookTools } from "./tools/books";
import { registerSeatRecordTools } from "./tools/seat-records";
import { registerSubscriptionTools } from "./tools/subscriptions";
import { registerTransactionTools } from "./tools/transactions";

// origin は MCP リクエストのURLのオリジン(アップロード用リンクの組み立てに使う)
export function createMcpServer(db: D1Database, bucket: R2Bucket, origin: string, fetchTitle?: TitleFetcher): McpServer {
  const server = new McpServer({ name: "receipt2life", title: "Receipt to Life +", version: "0.1.0" });
  registerTransactionTools(server, db, bucket, origin);
  registerCategoryTools(server, db);
  registerAccountTools(server, db);
  registerEventTools(server, db);
  registerReportTools(server, db);
  registerPhotoTools(server, db, bucket, origin);
  registerLinkTools(server, db, fetchTitle);
  registerSeatRecordTools(server, db);
  registerBookTools(server, db);
  registerSubscriptionTools(server, db);
  registerSearchTools(server, db);
  registerCompareTools(server, db);
  registerProductTools(server, db);
  registerMerchantTools(server, db);
  return server;
}
