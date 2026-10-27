import { AsyncLocalStorage } from "node:async_hooks";

import { OperationalInsightsManagementClient } from "@azure/arm-operationalinsights";
import type { TokenCredential } from "@azure/core-auth";
import { DefaultAzureCredential } from "@azure/identity";
import {
  LogsQueryClient,
  LogsQueryResultStatus,
  type LogsQueryClientOptions,
} from "@azure/monitor-query-logs";

import { resolveCloud, type AzureCloud } from "./cloud.js";
import { validateQuery, type QueryPolicyOptions } from "./query-policy.js";
import { shapeTable, type ShapedTable } from "./result-shaper.js";
import { parseTimespan } from "./timespan.js";
import { parseWorkspaceRef, parseWorkspaceResourceId } from "./workspace-id.js";

export interface WorkspaceQueryResult {
  status: LogsQueryResultStatus;
  tables: ShapedTable[];
  executionTimeSeconds?: number;
  partialError?: unknown;
}

/** Runs a policy-checked KQL query against one workspace. Implemented by LogAnalyticsService. */
export interface WorkspaceQueryRunner {
  runQuery(
    workspace: string,
    query: string,
    timespan: string,
    policy?: Partial<QueryPolicyOptions>,
    signal?: AbortSignal,
  ): Promise<WorkspaceQueryResult>;
}

export interface LogAnalyticsServiceOptions {
  cloud?: AzureCloud;
  /** Replaces the HTTP transport of every Azure client; tests use it to fake Azure. */
  httpClient?: LogsQueryClientOptions["httpClient"];
}

// LogsQueryClient (monitor-query-logs 1.0.0) drops `abortSignal` when it builds a query
// request, so each call's signal travels here and a pipeline policy attaches it instead.
const requestSignal = new AsyncLocalStorage<AbortSignal | undefined>();

const withSignal = (signal?: AbortSignal) => (signal ? { abortSignal: signal } : {});

export class LogAnalyticsService implements WorkspaceQueryRunner {
  readonly #credential: TokenCredential;
  readonly #cloud: AzureCloud;
  readonly #httpClient: LogsQueryClientOptions["httpClient"];
  readonly #queryClient: LogsQueryClient;
  readonly #customerIds = new Map<string, Promise<string>>();

  constructor(credential: TokenCredential = defaultCredential(), options: LogAnalyticsServiceOptions = {}) {
    this.#credential = credential;
    this.#cloud = options.cloud ?? defaultCloud();
    this.#httpClient = options.httpClient;
    // The endpoint replaces the whole base URL (no version is appended), and the token
    // scope is read from `credentials.scopes`, so both are set for the selected cloud.
    this.#queryClient = new LogsQueryClient(credential, {
      endpoint: `${this.#cloud.logAnalytics}/v1`,
      credentials: { scopes: [`${this.#cloud.logAnalytics}/.default`] },
      ...(this.#httpClient ? { httpClient: this.#httpClient } : {}),
    });
    this.#queryClient.pipeline.addPolicy({
      name: "azureQueryMcpAbortSignal",
      sendRequest(request, next) {
        const signal = requestSignal.getStore();
        if (signal) {
          request.abortSignal = request.abortSignal
            ? AbortSignal.any([request.abortSignal as AbortSignal, signal])
            : signal;
        }
        return next(request);
      },
    });
  }

  async listWorkspaces(subscriptionId: string, signal?: AbortSignal) {
    const client = this.#managementClient(subscriptionId);
    const workspaces = [];

    for await (const workspace of client.workspaces.list(withSignal(signal))) {
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

  async searchTables(workspaceResourceId: string, search?: string, signal?: AbortSignal) {
    const workspace = parseWorkspaceResourceId(workspaceResourceId);
    const client = this.#managementClient(workspace.subscriptionId);
    const normalizedSearch = search?.trim().toLocaleLowerCase();
    const tables = [];

    for await (const table of client.tables.listByWorkspace(
      workspace.resourceGroupName,
      workspace.workspaceName,
      withSignal(signal),
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

  async describeTable(workspaceResourceId: string, tableName: string, signal?: AbortSignal) {
    const workspace = parseWorkspaceResourceId(workspaceResourceId);
    const client = this.#managementClient(workspace.subscriptionId);
    const table = await client.tables.get(
      workspace.resourceGroupName,
      workspace.workspaceName,
      tableName,
      withSignal(signal),
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

  async queryWorkspace(workspace: string, query: string, timespan: string, signal?: AbortSignal) {
    return this.runQuery(workspace, query, timespan, {}, signal);
  }

  /**
   * Shared execution path for user KQL and the server's own SOC queries. Every query
   * passes the read-only policy; built-in queries may opt out of the explicit result
   * limit because output is still capped by the result shaper.
   */
  async runQuery(
    workspace: string,
    query: string,
    timespan: string,
    policy: Partial<QueryPolicyOptions> = {},
    signal?: AbortSignal,
  ): Promise<WorkspaceQueryResult> {
    validateQuery(query, { maxLength: 5_000, requireResultLimit: true, ...policy });
    const interval = parseTimespan(timespan);
    const workspaceId = await this.#workspaceId(workspace, signal);

    const result = await requestSignal.run(signal, () =>
      this.#queryClient.queryWorkspace(workspaceId, query, interval, {
        serverTimeoutInSeconds: 180,
        includeQueryStatistics: true,
      }),
    );
    const tables = result.status === LogsQueryResultStatus.PartialFailure
      ? result.partialTables
      : result.tables;
    // Only the execution time is useful to a client; the rest of the statistics payload
    // (resource usage, per-dataset counters) is large and costs tokens on every call.
    const executionTime: unknown = result.statistics?.query?.executionTime;

    return {
      status: result.status,
      tables: tables.map((table) => shapeTable(table)),
      ...(typeof executionTime === "number" ? { executionTimeSeconds: executionTime } : {}),
      ...(result.status === LogsQueryResultStatus.PartialFailure
        ? { partialError: result.partialError }
        : {}),
    };
  }

  /**
   * The query API takes the workspace customer ID. An ARM resource ID is resolved to it
   * through ARM once per workspace, the same lookup list_workspaces reports.
   */
  #workspaceId(workspace: string, signal?: AbortSignal): Promise<string> {
    const ref = parseWorkspaceRef(workspace);
    if (ref.kind === "id") {
      return Promise.resolve(ref.workspaceId);
    }

    const key = ref.resourceId.toLowerCase();
    let customerId = this.#customerIds.get(key);
    if (!customerId) {
      customerId = this.#managementClient(ref.subscriptionId)
        .workspaces.get(ref.resourceGroupName, ref.workspaceName, withSignal(signal))
        .then(({ customerId: id }) => {
          if (!id) {
            throw new Error("workspaceId could not be resolved: the workspace has no customer ID. Use the workspace ID from list_workspaces.");
          }
          return id;
        });
      this.#customerIds.set(key, customerId);
      customerId.catch(() => this.#customerIds.delete(key));
    }
    return customerId;
  }

  #managementClient(subscriptionId: string) {
    return new OperationalInsightsManagementClient(this.#credential, subscriptionId, {
      endpoint: this.#cloud.resourceManager,
      credentials: { scopes: [`${this.#cloud.resourceManager}/.default`] },
      ...(this.#httpClient ? { httpClient: this.#httpClient } : {}),
    });
  }
}

export function createDefaultCredential(cloud: AzureCloud = defaultCloud()): TokenCredential {
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  // authorityHost covers environment, workload and managed identity credentials. Azure
  // CLI uses its own cloud setting (`az cloud set`), which must match.
  return new DefaultAzureCredential({ ...(tenantId ? { tenantId } : {}), authorityHost: cloud.authorityHost });
}

let sharedCloud: AzureCloud | undefined;
let sharedCredential: TokenCredential | undefined;

/** The cloud selected by AZURE_QUERY_MCP_CLOUD, resolved once. */
export function defaultCloud(): AzureCloud {
  return (sharedCloud ??= resolveCloud());
}

/** One credential for every service, so they share a token cache. */
export function defaultCredential(): TokenCredential {
  return (sharedCredential ??= createDefaultCredential());
}
