import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

async function withClient(run: (client: Client) => Promise<void>) {
  const client = new Client({ name: "protocol-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
  });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
  }
}

test("advertises all tools with distinct query routing guidance", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

    assert.deepEqual(
      [...toolsByName.keys()].sort(),
      [
        "check_ingestion_health",
        "describe_table",
        "entity_timeline",
        "get_incident",
        "list_hunting_queries",
        "list_incidents",
        "list_workspaces",
        "query_azure_resources",
        "query_workspace",
        "run_hunting_query",
        "search_tables",
      ],
    );
    assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true), "every tool must be read-only");
    assert.match(toolsByName.get("query_workspace")?.description ?? "", /telemetry, logs/);
    assert.match(toolsByName.get("query_workspace")?.description ?? "", /Do not use for Azure resource inventory/);
    assert.match(toolsByName.get("query_azure_resources")?.description ?? "", /resource inventory, configuration/);
    assert.match(toolsByName.get("query_azure_resources")?.description ?? "", /Do not use for telemetry, logs/);
    assert.match(toolsByName.get("get_incident")?.description ?? "", /entity_timeline/);
  });
});

test("advertises SOC workflow prompts", async () => {
  await withClient(async (client) => {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((prompt) => prompt.name).sort(), ["ingestion_health_review", "triage_incident"]);

    const triage = await client.getPrompt({
      name: "triage_incident",
      arguments: { workspaceId: "4f2a8c1e-7b3d-4e5f-9a6b-1c2d3e4f5a6b", incidentNumber: "12" },
    });
    const text = triage.messages[0]?.content.type === "text" ? triage.messages[0].content.text : "";
    assert.match(text, /incident 12/);
    assert.match(text, /get_incident/);
    assert.match(text, /entity_timeline/);
  });
});

test("lists built-in hunting queries without Azure access", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_hunting_queries", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const ids = (JSON.parse(content[0]?.text ?? "{}").queries as Array<{ id: string }>).map((query) => query.id);
    assert.ok(ids.includes("password-spray"));
    assert.ok(ids.includes("mfa-fatigue"));
  });
});
