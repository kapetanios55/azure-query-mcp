import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { LogAnalyticsService } from "./azure-service.js";
import { ResourceGraphService } from "./resource-graph-service.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: safeErrorMessage(error) }],
  };
}

export function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Request failed. Verify the inputs, Azure authentication, RBAC, and service availability.";
  }

  const safeMessages = /^(?:KQL query|Only read-only KQL|Azure Resource Graph query|Only read-only Azure Resource Graph|workspaceResourceId|Azure authentication did not return|Azure Resource Graph request failed with HTTP|Azure Resource Graph response exceeds)/;
  return safeMessages.test(error.message)
    ? error.message
    : "Request failed. Verify the inputs, Azure authentication, RBAC, and service availability.";
}

export function createServer(
  logAnalyticsService = new LogAnalyticsService(),
  resourceGraphService = new ResourceGraphService(),
) {
  const server = new McpServer({ name: "azure-data-explorer-mcp", version: "0.2.0" });

  server.registerTool(
    "list_workspaces",
    {
      description: "List Azure Log Analytics workspaces accessible in a subscription.",
      inputSchema: z.object({
        subscriptionId: z.string().uuid().describe("Azure subscription ID."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ subscriptionId }) => {
      try {
        return toolResult(await logAnalyticsService.listWorkspaces(subscriptionId));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "search_tables",
    {
      description: "List or search tables in a Log Analytics workspace using ARM metadata.",
      inputSchema: z.object({
        workspaceResourceId: z.string().describe("Full ARM resource ID of the workspace."),
        search: z.string().max(200).optional().describe("Optional name or description substring."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceResourceId, search }) => {
      try {
        return toolResult(await logAnalyticsService.searchTables(workspaceResourceId, search));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "describe_table",
    {
      description: "Get the canonical schema and retention metadata for a Log Analytics table.",
      inputSchema: z.object({
        workspaceResourceId: z.string().describe("Full ARM resource ID of the workspace."),
        tableName: z.string().min(1).max(260).describe("Case-sensitive table name."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceResourceId, tableName }) => {
      try {
        return toolResult(await logAnalyticsService.describeTable(workspaceResourceId, tableName));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "query_workspace",
    {
      description: "Use for telemetry, logs, events, metrics, and time-series data stored in a Log Analytics workspace. Run bounded, read-only KQL against one workspace. Do not use for Azure resource inventory or configuration; use query_azure_resources for those.",
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe("Log Analytics workspace customer ID."),
        query: z.string().min(1).max(5_000).describe("Read-only KQL with a result-limiting operator."),
        timespan: z.string().regex(/^P(?!$).+/).max(100).describe("ISO 8601 duration, such as PT1H."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceId, query, timespan }) => {
      try {
        return toolResult(await logAnalyticsService.queryWorkspace(workspaceId, query, timespan));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "query_azure_resources",
    {
      description: "Use for Azure resource inventory, configuration, tags, policy, health, and cross-subscription discovery through Azure Resource Graph. Do not use for telemetry, logs, events, or time-series analysis; use query_workspace for those.",
      inputSchema: z.object({
        subscriptionIds: z.array(z.string().uuid()).min(1).max(100).describe("One or more Azure subscription IDs that bound the query scope."),
        query: z.string().min(1).max(5_000).describe("Read-only Azure Resource Graph KQL beginning with an ARG table such as Resources."),
        maxResults: z.number().int().min(1).max(1_000).default(100).describe("Maximum rows returned in this page."),
        skipToken: z.string().min(1).max(4_096).optional().describe("Opaque continuation token returned by the preceding identical query."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ subscriptionIds, query, maxResults, skipToken }) => {
      try {
        return toolResult(await resourceGraphService.queryResources(subscriptionIds, query, maxResults, skipToken));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}