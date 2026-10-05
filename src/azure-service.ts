import { OperationalInsightsManagementClient } from "@azure/arm-operationalinsights";
import type { TokenCredential } from "@azure/core-auth";
import { DefaultAzureCredential } from "@azure/identity";
import {
  LogsQueryClient,
  LogsQueryResultStatus,
} from "@azure/monitor-query-logs";

import { validateQuery, type QueryPolicyOptions } from "./query-policy.js";
import { shapeTable, type ShapedTable } from "./result-shaper.js";
import { parseWorkspaceResourceId } from "./workspace-id.js";

export interface WorkspaceQueryResult {
  status: LogsQueryResultStatus;
  tables: ShapedTable[];
  statistics?: unknown;
  partialError?: unknown;
}

/** Runs a policy-checked KQL query against one workspace. Implemented by LogAnalyticsService. */
export interface WorkspaceQueryRunner {
  runQuery(
    workspaceId: string,
    query: string,
    timespan: string,
    policy?: Partial<QueryPolicyOptions>,
  ): Promise<WorkspaceQueryResult>;
}

export class LogAnalyticsService implements WorkspaceQueryRunner {
  readonly #credential: TokenCredential;
  readonly #queryClient: LogsQueryClient;

  constructor(credential: TokenCredential = createDefaultCredential()) {
    this.#credential = credential;
    this.#queryClient = new LogsQueryClient(credential);
  }

  async listWorkspaces(subscriptionId: string) {
    const client = this.#managementClient(subscriptionId);
    const workspaces = [];

    for await (const workspace of client.workspaces.list()) {
      if (!workspace.id || !workspace.name || !workspace.customerId) {
        continue;
      }

      const parsed = parseWorkspaceResourceId(workspace.id);
      workspaces.push({
        name: workspace.name,
        workspaceId: workspace.customerId,
        resourceId: workspace.id,
        subscriptionId: parsed.subscriptionId,
        resourceGroupName: parsed.resourceGroupName,
        location: workspace.location,
      });
    }

    return workspaces;
  }

  async searchTables(workspaceResourceId: string, search?: string) {
    const workspace = parseWorkspaceResourceId(workspaceResourceId);
    const client = this.#managementClient(workspace.subscriptionId);
    const normalizedSearch = search?.trim().toLocaleLowerCase();
    const tables = [];

    for await (const table of client.tables.listByWorkspace(
      workspace.resourceGroupName,
      workspace.workspaceName,
    )) {
      const schema = table.schema;
      const searchable = [table.name, schema?.displayName, schema?.description]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();

      if (normalizedSearch && !searchable.includes(normalizedSearch)) {
        continue;
      }

      tables.push({
        name: table.name,
        displayName: schema?.displayName,
        description: schema?.description,
        plan: table.plan,
        retentionInDays: table.retentionInDays,
        categories: schema?.categories ?? [],
      });
    }

    return tables.sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));
  }

  async describeTable(workspaceResourceId: string, tableName: string) {
    const workspace = parseWorkspaceResourceId(workspaceResourceId);
    const client = this.#managementClient(workspace.subscriptionId);
    const table = await client.tables.get(
      workspace.resourceGroupName,
      workspace.workspaceName,
      tableName,
    );
    const schema = table.schema;

    return {
      name: table.name,
      displayName: schema?.displayName,
      description: schema?.description,
      plan: table.plan,
      retentionInDays: table.retentionInDays,
      totalRetentionInDays: table.totalRetentionInDays,
      categories: schema?.categories ?? [],
      source: schema?.source,
      tableType: schema?.tableType,
      columns: [...(schema?.standardColumns ?? []), ...(schema?.columns ?? [])],
    };
  }

  async queryWorkspace(workspaceId: string, query: string, timespan: string) {
    return this.runQuery(workspaceId, query, timespan);
  }

  /**
   * Shared execution path for user KQL and the server's own SOC queries. Every query
   * passes the read-only policy; built-in queries may opt out of the explicit result
   * limit because output is still capped by the result shaper.
   */
  async runQuery(
    workspaceId: string,
    query: string,
    timespan: string,
    policy: Partial<QueryPolicyOptions> = {},
  ): Promise<WorkspaceQueryResult> {
    validateQuery(query, { maxLength: 5_000, requireResultLimit: true, ...policy });

    const result = await this.#queryClient.queryWorkspace(workspaceId, query, { duration: timespan }, {
      serverTimeoutInSeconds: 180,
      includeQueryStatistics: true,
    });
    const tables = result.status === LogsQueryResultStatus.PartialFailure
      ? result.partialTables
      : result.tables;

    return {
      status: result.status,
      tables: tables.map((table) => shapeTable(table)),
      statistics: result.statistics,
      ...(result.status === LogsQueryResultStatus.PartialFailure
        ? { partialError: result.partialError }
        : {}),
    };
  }

  #managementClient(subscriptionId: string) {
    return new OperationalInsightsManagementClient(this.#credential, subscriptionId);
  }
}

export function createDefaultCredential() {
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  return new DefaultAzureCredential(tenantId ? { tenantId } : {});
}