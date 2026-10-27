#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createServer } from "./server.js";

let server;
try {
  server = createServer();
} catch (error) {
  // Configuration errors (such as an unknown AZURE_QUERY_MCP_CLOUD) stop the server with
  // one readable line in the MCP client's log instead of a stack trace.
  console.error(`azure-query-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
await server.connect(new StdioServerTransport());
