import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { LogAnalyticsService } from "./azure-service.js";
import { ResourceGraphService } from "./resource-graph-service.js";
import { incidentSeverities, incidentStatuses } from "./soc-queries.js";
import { SocService } from "./soc-service.js";

// Resolves to the package root from both src/ (tests) and dist/ (published build).
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

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

  const safeMessages = /^(?:KQL query|Only read-only KQL|The evaluate plugin|Entity value|Hunting query|Azure Resource Graph query|Only read-only Azure Resource Graph|workspaceResourceId|Azure authentication did not return|Azure Resource Graph request failed with HTTP|Azure Resource Graph response exceeds)/;
  return safeMessages.test(error.message)
    ? error.message
    : "Request failed. Verify the inputs, Azure authentication, RBAC, and service availability.";
}

const workspaceIdSchema = z.string().uuid().describe("Log Analytics workspace customer ID (from list_workspaces).");
const timespanSchema = (fallback: string) =>
  z.string().regex(/^P(?!$).+/).max(100).default(fallback).describe(`ISO 8601 lookback, such as P7D or PT12H. Default ${fallback}.`);

export function createServer(
  logAnalyticsService = new LogAnalyticsService(),
  resourceGraphService = new ResourceGraphService(),
  socService = new SocService(logAnalyticsService),
) {
  const server = new McpServer({ name: "azure-query-mcp", version });

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

  // ---------------------------------------------------------------------------
  // SOC tools: purpose-built, read-only investigations over Microsoft Sentinel data.
  // ---------------------------------------------------------------------------

  server.registerTool(
    "list_incidents",
    {
      description: "List Microsoft Sentinel incidents (latest state of each) from the SecurityIncident table, newest first. Use to find incidents to triage; then call get_incident for details.",
      inputSchema: z.object({
        workspaceId: workspaceIdSchema,
        timespan: timespanSchema("P7D"),
        statuses: z.array(z.enum(incidentStatuses)).max(3).optional().describe("Filter by status."),
        severities: z.array(z.enum(incidentSeverities)).max(4).optional().describe("Filter by severity."),
        maxResults: z.number().int().min(1).max(200).default(50).describe("Maximum incidents returned."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceId, timespan, statuses, severities, maxResults }) => {
      try {
        return toolResult(await socService.listIncidents(workspaceId, timespan, { statuses, severities, maxResults }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_incident",
    {
      description: "Get one Microsoft Sentinel incident with its alerts and the account, IP and host entities involved. Returned pivotEntities can be passed directly to entity_timeline; unresolvedEntities lists entities recorded without a usable identifier (for example only a display name or SID).",
      inputSchema: z.object({
        workspaceId: workspaceIdSchema,
        incidentNumber: z.number().int().min(1).describe("Incident number as shown in Sentinel."),
        timespan: timespanSchema("P30D"),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceId, incidentNumber, timespan }) => {
      try {
        return toolResult(await socService.getIncident(workspaceId, incidentNumber, timespan));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "entity_timeline",
    {
      description: "Build a cross-source activity timeline for one account (UPN), IP address or host: sign-ins, audit events, Office activity, endpoint telemetry, firewall logs and alerts. Tables that are not ingested are skipped automatically.",
      inputSchema: z.object({
        workspaceId: workspaceIdSchema,
        entityType: z.enum(["account", "ip", "host"]).describe("Kind of entity."),
        entity: z.string().min(1).max(253).describe("UPN (user@domain), IPv4/IPv6 address, or hostname/FQDN."),
        timespan: timespanSchema("P7D"),
        maxEvents: z.number().int().min(1).max(500).default(200).describe("Maximum timeline events returned (per-source totals are always complete)."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceId, entityType, entity, timespan, maxEvents }) => {
      try {
        return toolResult(await socService.entityTimeline(workspaceId, entityType, entity, timespan, maxEvents));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "check_ingestion_health",
    {
      description: "Check whether log data is still arriving: per-table last-seen time, 24h volume versus the previous daily average, stale tables, volume drops or spikes, and ingestion latency over the last hour.",
      inputSchema: z.object({
        workspaceId: workspaceIdSchema,
        timespan: timespanSchema("P7D"),
        staleAfterHours: z.number().int().min(1).max(168).default(24).describe("Flag a table as Stale when no data arrived for this many hours."),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceId, timespan, staleAfterHours }) => {
      try {
        return toolResult(await socService.checkIngestionHealth(workspaceId, timespan, staleAfterHours));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_hunting_queries",
    {
      description: "List the available threat-hunting queries (built-in plus any loaded from AZURE_QUERY_MCP_HUNTING_DIR) with their MITRE ATT&CK tactics and techniques.",
      inputSchema: z.object({}),
      annotations: { ...readOnlyAnnotations, openWorldHint: false },
    },
    async () => toolResult(socService.listHuntingQueries()),
  );

  server.registerTool(
    "run_hunting_query",
    {
      description: "Run one hunting query from list_hunting_queries against a workspace. Results are capped at 1,000 rows.",
      inputSchema: z.object({
        workspaceId: workspaceIdSchema,
        queryId: z.string().min(1).max(200).describe("ID from list_hunting_queries."),
        timespan: timespanSchema("P7D"),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ workspaceId, queryId, timespan }) => {
      try {
        return toolResult(await socService.runHuntingQuery(workspaceId, queryId, timespan));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerPrompt(
    "triage_incident",
    {
      title: "Triage a Sentinel incident",
      description: "Walk through an incident: details, alerts, entity timelines, and a verdict with next steps.",
      argsSchema: z.object({
        workspaceId: z.string().describe("Log Analytics workspace customer ID."),
        incidentNumber: z.string().describe("Sentinel incident number."),
      }),
    },
    ({ workspaceId, incidentNumber }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Triage Microsoft Sentinel incident ${incidentNumber} in workspace ${workspaceId}.`,
            "1. Call get_incident and summarise what fired, when, and the MITRE tactics involved.",
            "2. For the most relevant pivotEntities (at most three), call entity_timeline with a window that covers the incident.",
            "3. Look for corroborating or contradicting activity: successful sign-ins after failures, new locations, process execution, outbound connections.",
            "4. Give a verdict (likely true positive, benign positive, or false positive) with the evidence for it, and concrete next steps.",
            "Use only these read-only tools; do not guess at data you have not queried.",
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "ingestion_health_review",
    {
      title: "Is my security data still arriving?",
      description: "Review log ingestion health and explain any stale tables, volume changes or latency.",
      argsSchema: z.object({
        workspaceId: z.string().describe("Log Analytics workspace customer ID."),
      }),
    },
    ({ workspaceId }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Review data ingestion health for workspace ${workspaceId}.`,
            "1. Call check_ingestion_health.",
            "2. List stale tables first, then volume drops, spikes and high latency, each with the likely cause (connector disabled, agent offline, DCR change, noisy source).",
            "3. Explain the detection impact: which security detections would go blind if this data is missing.",
            "4. Suggest specific checks to confirm each cause.",
          ].join("\n"),
        },
      }],
    }),
  );

  return server;
}