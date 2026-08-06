import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("advertises all tools with distinct query routing guidance", async () => {
  const client = new Client({ name: "protocol-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

    assert.deepEqual(
      [...toolsByName.keys()].sort(),
      [
        "describe_table",
        "list_workspaces",
        "query_azure_resources",
        "query_workspace",
        "search_tables",
      ],
    );
    assert.match(toolsByName.get("query_workspace")?.description ?? "", /telemetry, logs/);
    assert.match(toolsByName.get("query_workspace")?.description ?? "", /Do not use for Azure resource inventory/);
    assert.match(toolsByName.get("query_azure_resources")?.description ?? "", /resource inventory, configuration/);
    assert.match(toolsByName.get("query_azure_resources")?.description ?? "", /Do not use for telemetry, logs/);
  } finally {
    await client.close();
  }
});