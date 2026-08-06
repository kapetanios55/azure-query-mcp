# Azure Query MCP

A read-only Model Context Protocol server for querying Azure Log Analytics and Azure Resource Graph (ARG). It runs locally over stdio and uses Azure RBAC through `DefaultAzureCredential`.

## Choose the right tool

| Need | MCP tool | Data source |
| --- | --- | --- |
| Logs, events, telemetry, metrics, incidents, or time-series analysis | `query_workspace` | Log Analytics workspace |
| Azure resource inventory, configuration, tags, policy, health, or cross-subscription discovery | `query_azure_resources` | Azure Resource Graph |
| Find a workspace or inspect its tables and schemas | `list_workspaces`, `search_tables`, `describe_table` | Azure Resource Manager |

ARG describes Azure control-plane resources and can be slightly delayed. It does not contain workspace log records. Log Analytics queries require a workspace customer ID and an ISO 8601 timespan.

## Security properties

- All tools are marked read-only, non-destructive, and idempotent.
- ARG calls a fixed Microsoft endpoint with API version `2024-04-01`; users cannot control the URL.
- ARG requires explicit subscription scope and caps each page at 1,000 rows and 5 MiB.
- Log Analytics requires bounded KQL and caps output at 1,000 rows and 2,000 characters per cell.
- Requests time out, upstream ARG error bodies are not returned, and access tokens are never logged.
- Authentication and authorization are delegated to Microsoft Entra ID and Azure RBAC.

See [SECURITY.md](SECURITY.md) before production deployment.

## Requirements

- Node.js 22 or later
- An Azure identity available to `DefaultAzureCredential`
- Azure RBAC on only the subscriptions and workspaces the server should query

For local development, sign in with Azure CLI:

```powershell
az login --tenant <tenant-id>
$env:AZURE_TENANT_ID = "<tenant-id>"
```

For production, use managed identity or workload identity. Avoid client secrets when the hosting platform supports federation.

## Install and run

```powershell
npm ci
npm run check
npm start
```

VS Code MCP configuration:

```json
{
  "servers": {
    "azure-query": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/azure-query-mcp/dist/index.js"],
      "env": {
        "AZURE_TENANT_ID": "${input:azureTenantId}"
      }
    }
  },
  "inputs": [
    {
      "id": "azureTenantId",
      "type": "promptString",
      "description": "Microsoft Entra tenant ID"
    }
  ]
}
```

Never place `AZURE_CLIENT_SECRET` directly in a committed MCP configuration. Use the host's secret store or managed identity.

## Tools

### `query_azure_resources`

Runs read-only ARG KQL against one or more explicitly supplied subscription IDs. The query must begin with a supported ARG table such as `Resources`.

```text
subscriptionIds: ["00000000-0000-4000-8000-000000000000"]
query: Resources | where type =~ 'microsoft.compute/virtualmachines' | project id, name, resourceGroup, location | order by name asc | limit 50
maxResults: 50
```

Use the returned `skipToken` with the identical query and subscription scope to request another page.

### `query_workspace`

Runs bounded read-only KQL against one Log Analytics workspace. A result-limiting operator and timespan are mandatory.

```text
workspaceId: 00000000-0000-4000-8000-000000000000
query: Heartbeat | project TimeGenerated, Computer | take 50
timespan: PT1H
```

The remaining tools discover workspaces and inspect Log Analytics table metadata.

## Development

```powershell
npm run check
npm audit --omit=dev
```

The implementation follows the Microsoft Learn [Azure Resource Graph REST API](https://learn.microsoft.com/azure/governance/resource-graph/first-query-rest-api) and [Resources API reference](https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources?view=rest-azureresourcegraph-resourcegraph-2024-04-01).

## License

[MIT](LICENSE)
