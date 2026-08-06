# Azure Query MCP

A read-only Model Context Protocol server for querying Azure Log Analytics and Azure Resource Graph (ARG). It runs locally over stdio and uses Azure RBAC through `DefaultAzureCredential`.

## What users should install

This project is currently distributed from source. Each user runs the MCP server locally and authenticates with their own Microsoft Entra identity. Nothing is deployed into an Azure tenant, and the server does not receive shared credentials.

Use it when an MCP client needs both of these Azure data planes:

- Log Analytics for logs, events, telemetry, and time-series analysis.
- Azure Resource Graph for resource inventory and control-plane configuration.

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

## Prerequisites

- Git
- Node.js 22 or later
- Azure CLI for local interactive authentication
- An Azure identity available to `DefaultAzureCredential`
- Azure RBAC on only the subscriptions and workspaces that should be queried

Recommended least-privilege roles:

| Capability | Suggested role and scope |
| --- | --- |
| Query ARG and discover workspaces | `Reader` on the required subscription or narrower resource scope |
| Read Log Analytics schemas and data | `Log Analytics Reader` on each required workspace |

Custom roles can be narrower. The effective permissions must include the relevant Azure Resource Manager read operations and Log Analytics query access.

## Set up locally

1. Clone and build the server.

   ```powershell
   git clone https://github.com/kapetanios55/azure-query-mcp.git
   Set-Location azure-query-mcp
   npm ci
   npm run check
   ```

2. Sign in to the tenant that contains the target subscriptions and workspaces.

   ```powershell
   az login --tenant <tenant-id>
   az account list --output table
   ```

3. Add the server to the MCP client. For VS Code, add this to `.vscode/mcp.json` and replace the path with the absolute path to the cloned repository.

   ```json
   {
     "inputs": [
       {
         "id": "azureTenantId",
         "type": "promptString",
         "description": "Microsoft Entra tenant ID"
       }
     ],
     "servers": {
       "azure-query": {
         "type": "stdio",
         "command": "node",
         "args": ["C:/path/to/azure-query-mcp/dist/index.js"],
         "env": {
           "AZURE_TENANT_ID": "${input:azureTenantId}"
         }
       }
     }
   }
   ```

4. Start `azure-query` from the MCP server view. Reload the VS Code window if the server does not appear after editing the configuration.

5. Verify both paths with prompts such as:

   ```text
   List the Log Analytics workspaces in subscription <subscription-id>.
   Show the schema of the Heartbeat table in workspace <workspace-resource-id>.
   Use Azure Resource Graph to count resources by type in subscription <subscription-id>.
   ```

For production, use managed identity or workload identity. Avoid client secrets when the hosting platform supports federation.

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

## Log Analytics examples

The examples below use `query_workspace`. Supply the workspace customer ID and an explicit ISO 8601 timespan with every request. Table availability depends on the workspace configuration.

### Agent heartbeat recency

Prompt:

```text
For the last 24 hours, show the 25 computers with the most recent heartbeat.
```

KQL:

```kusto
Heartbeat
| summarize LastHeartbeat=max(TimeGenerated) by Computer
| top 25 by LastHeartbeat desc
```

Timespan: `P1D`

### Most common failed sign-ins

Prompt:

```text
For the last seven days, show the 20 users with the most failed sign-ins.
```

KQL:

```kusto
SigninLogs
| where ResultType != 0
| summarize FailedSignIns=count() by UserPrincipalName
| top 20 by FailedSignIns desc
```

Timespan: `P7D`

### Recent Sentinel incidents

Prompt:

```text
Show the 20 most recently updated Microsoft Sentinel incidents from the last seven days.
```

KQL:

```kusto
SecurityIncident
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| project TimeGenerated, IncidentNumber, Title, Severity, Status, Owner
| top 20 by TimeGenerated desc
```

Timespan: `P7D`

Use `search_tables` when the table name is unknown, then use `describe_table` to retrieve the canonical column names and types before writing KQL.

## Azure Resource Graph examples

The examples below use `query_azure_resources` and one or more explicit subscription IDs. ARG reports Azure control-plane state and can be slightly delayed.

### Count resources by type

```kusto
Resources
| summarize ResourceCount=count() by type
| top 25 by ResourceCount desc
```

### List virtual machines

```kusto
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| project id, name, resourceGroup, subscriptionId, location
| order by name asc
| limit 100
```

### Find resources missing an owner tag

```kusto
Resources
| where isempty(tags.owner)
| project id, name, type, resourceGroup, subscriptionId
| order by type asc, name asc
| limit 100
```

### Count NSGs with an inbound port allowed from the internet

Set `targetPort` to the port to investigate. This query handles a single destination port, destination port arrays, ranges such as `5000-5100`, and the `*` wildcard. It also handles single and array source prefixes.

```kusto
Resources
| where type =~ 'microsoft.network/networksecuritygroups'
| mv-expand rule = properties.securityRules
| where tostring(rule.properties.direction) =~ 'Inbound'
    and tostring(rule.properties.access) =~ 'Allow'
| extend sourcePrefixes = iif(
    array_length(rule.properties.sourceAddressPrefixes) > 0,
    rule.properties.sourceAddressPrefixes,
    pack_array(rule.properties.sourceAddressPrefix)
  ), destinationPorts = iif(
    array_length(rule.properties.destinationPortRanges) > 0,
    rule.properties.destinationPortRanges,
    pack_array(rule.properties.destinationPortRange)
  )
| mv-expand sourcePrefix = sourcePrefixes
| where tostring(sourcePrefix) in~ ('*', 'Internet', '0.0.0.0/0', '::/0')
| mv-expand destinationPort = destinationPorts
| extend portText=tostring(destinationPort), targetPort=22
| extend rangeStart=toint(split(portText, '-')[0]),
         rangeEnd=toint(split(portText, '-')[1])
| where portText == '*'
    or targetPort == toint(portText)
    or (rangeStart <= targetPort and rangeEnd >= targetPort)
| summarize MatchingRules=count(),
            NsgCount=dcount(id),
            Nsgs=make_set(name, 100)
```

This query shape was tested against Azure Resource Graph with both positive and zero-result ports.

Important: this identifies candidate exposure in configured custom NSG rules. It does not calculate effective packet reachability, rule priority conflicts, subnet and NIC associations, public IP presence, routes, Azure Firewall behavior, or application listeners. Treat the result as an investigation starting point, not proof that a service is reachable from the internet.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Wrong-token-issuer or tenant error | Run `az login --tenant <tenant-id>` and make sure `AZURE_TENANT_ID` uses the same tenant. |
| `AuthorizationFailed` from ARG | Verify Reader access at the requested subscription or resource scope. |
| Workspace metadata works but queries fail | Verify Log Analytics Reader access to the workspace and confirm the workspace customer ID. |
| Table not found | Run `search_tables`, then query the exact returned table name. |
| Query rejected as unbounded | Add `take`, `limit`, `top`, `summarize`, or `count` as appropriate. |
| Server is not visible in VS Code | Run `npm run build`, verify the absolute `dist/index.js` path, then restart the MCP server or reload VS Code. |

## Development

```powershell
npm run check
npm audit --omit=dev
```

The implementation follows the Microsoft Learn [Azure Resource Graph REST API](https://learn.microsoft.com/azure/governance/resource-graph/first-query-rest-api) and [Resources API reference](https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources?view=rest-azureresourcegraph-resourcegraph-2024-04-01).

## License

[MIT](LICENSE)
