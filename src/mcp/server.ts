import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEventTools } from "./tools/events";
import { registerReportTools } from "./tools/reports";
import { registerTransactionTools } from "./tools/transactions";

export function createMcpServer(db: D1Database): McpServer {
  const server = new McpServer({ name: "receipt2life", version: "0.1.0" });
  registerTransactionTools(server, db);
  registerEventTools(server, db);
  registerReportTools(server, db);
  return server;
}
