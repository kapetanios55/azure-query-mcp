# Azure Query MCP

[![npm](https://img.shields.io/npm/v/@akapetaniou/azure-query-mcp)](https://www.npmjs.com/package/@akapetaniou/azure-query-mcp)
[![CI](https://github.com/kapetanios55/azure-query-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kapetanios55/azure-query-mcp/actions/workflows/ci.yml)
[![CodeQL](https://github.com/kapetanios55/azure-query-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/kapetanios55/azure-query-mcp/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A read-only Model Context Protocol server for querying Azure Log Analytics, Microsoft Sentinel and Azure Resource Graph (ARG), with purpose-built SOC tools for incident triage, entity investigation, ingestion health and threat hunting. It runs locally over stdio and uses Azure RBAC through `DefaultAzureCredential`.

## What users should install

The server is published to npm as `@akapetaniou/azure-query-mcp` and runs with `npx`, so there is nothing to clone or build. Each user runs it locally and authenticates with their own Microsoft Entra identity. Nothing is deployed into an Azure tenant, and the server does not receive shared credentials.

Use it when an MCP client needs both of these Azure data planes:

- Log Analytics for logs, events, telemetry, and time-series analysis.
- Azure Resource Graph for resource inventory and control-plane configuration.

## Choose the right tool

| Need | MCP tool | Data source |
| --- | --- | --- |
| Logs, events, telemetry, metrics, incidents, or time-series analysis | `query_workspace` | Log Analytics workspace |
| Azure resource inventory, configuration, tags, policy, health, or cross-subscription discovery | `query_azure_resources` | Azure Resource Graph |
| Find a workspace or inspect its tables and schemas | `list_workspaces`, `search_tables`, `describe_table` | Azure Resource Manager |
| Find and triage Microsoft Sentinel incidents | `list_incidents`, `get_incident` | `SecurityIncident`, `SecurityAlert` |
| Everything one account, IP or host did across log sources | `entity_timeline` | Sign-in, audit, Office, endpoint, firewall and alert tables |
| Is security data still arriving? Stale tables, volume drops, latency | `check_ingestion_health` | `Usage` plus a one-hour latency sample |
| Run curated threat hunts | `list_hunting_queries`, `run_hunting_query` | Built-in library plus your own JSON hunts |

ARG describes Azure control-plane resources and can be slightly delayed. It does not contain workspace log records. Log Analytics queries require a workspace customer ID and an ISO 8601 timespan.

## Security properties

- All tools are marked read-only, non-destructive, and idempotent.
- ARG calls a fixed Microsoft endpoint with API version `2024-04-01`; users cannot control the URL.
- ARG requires explicit subscription scope and caps each page at 1,000 rows and 5 MiB.
- Log Analytics requires bounded KQL and caps output at 1,000 rows and 2,000 characters per cell.
- The read-only query policy ignores string literals and comments, so hunting filters such as `where OperationName has "delete"` are allowed while real management commands, `set` statements and `externaldata` are rejected. Malformed (unterminated) strings fail closed.
- `evaluate` is limited to plugins that only reshape returned rows: `autocluster`, `bag_unpack`, `basket`, `diffpatterns`, `ipv4_lookup`, `ipv6_lookup`, `narrow`, `pivot` and `preview`. Plugins that reach outside the workspace (`http_request`, `sql_request`, `python`, `r`, ...) are blocked.
- Releases are published from GitHub Actions with npm provenance, so each package version is traceable to the commit and workflow that built it.
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
| Read Log Analytics schemas and data, and use the SOC tools | `Log Analytics Reader` on each required workspace |

Custom roles can be narrower. The effective permissions must include the relevant Azure Resource Manager read operations and Log Analytics query access.

## Quick start

1. Sign in to the tenant that contains the target subscriptions and workspaces.

   ```bash
   az login --tenant <tenant-id>
   az account list --output table
   ```

2. Add the server to your MCP client. Each client starts it with `npx`, which downloads the published package on first use.

   **VS Code** (`.vscode/mcp.json`):

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
         "command": "npx",
         "args": ["-y", "@akapetaniou/azure-query-mcp"],
         "env": {
           "AZURE_TENANT_ID": "${input:azureTenantId}"
         }
       }
     }
   }
   ```

   **Claude Desktop** (`claude_desktop_config.json`) and **Cursor** (`~/.cursor/mcp.json`):

   ```json
   {
     "mcpServers": {
       "azure-query": {
         "command": "npx",
         "args": ["-y", "@akapetaniou/azure-query-mcp"],
         "env": {
           "AZURE_TENANT_ID": "<tenant-id>"
         }
       }
     }
   }
   ```

   **Claude Code**:

   ```bash
   claude mcp add azure-query --env AZURE_TENANT_ID=<tenant-id> -- npx -y @akapetaniou/azure-query-mcp
   ```

3. Verify both paths with prompts such as:

   ```text
   List the Log Analytics workspaces in subscription <subscription-id>.
   Show the schema of the Heartbeat table in workspace <workspace-resource-id>.
   Use Azure Resource Graph to count resources by type in subscription <subscription-id>.
   ```

For production, use managed identity or workload identity. Avoid client secrets when the hosting platform supports federation.

Never place `AZURE_CLIENT_SECRET` directly in a committed MCP configuration. Use the host's secret store or managed identity.

## Run from source

To work on the server itself, clone and build it, then point your MCP client at `dist/index.js` instead of `npx`:

```bash
git clone https://github.com/kapetanios55/azure-query-mcp.git
cd azure-query-mcp
npm ci
npm run check
```

```json
"azure-query": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/azure-query-mcp/dist/index.js"]
}
```

## SOC tools

These tools generate their own KQL, so the client does not need to know table schemas. Every generated query goes through the same read-only policy as `query_workspace`, results are capped at 1,000 rows, and all of them need only `Log Analytics Reader`. Incidents are read from the `SecurityIncident` and `SecurityAlert` tables, so Microsoft Sentinel must be enabled on the workspace for `list_incidents` and `get_incident`.

| Tool | What it returns |
| --- | --- |
| `list_incidents` | Latest state of each incident, newest first, filterable by status and severity. |
| `get_incident` | One incident with its alerts and the account, IP and host entities involved (`pivotEntities`), ready to pass to `entity_timeline`. |
| `entity_timeline` | A cross-source timeline for a UPN, IP or host, plus complete per-source event counts. Tables that are not ingested are skipped with `union isfuzzy=true`. |
| `check_ingestion_health` | Per-table last-seen time, last-24-hour volume versus the previous daily average, `Stale` / `VolumeDrop` / `VolumeSpike` status, and P50/P95 ingestion latency over the last hour. |
| `list_hunting_queries` / `run_hunting_query` | Built-in hunts (password spray, MFA fatigue, privileged role assignment, inbox forwarding rules, Office apps spawning shells) mapped to MITRE ATT&CK. |

Entity values are validated against strict UPN, IP and hostname formats before they are placed in a query, because the Log Analytics API has no parameter binding. Values containing quotes, backslashes or whitespace are rejected.

### Your own hunting queries

Set `AZURE_QUERY_MCP_HUNTING_DIR` to a folder of JSON hunting queries in the [SentinelCBContent](https://github.com/kapetanios55/SentinelCBContent) format (`id`, `name`, `description`, `tactics`, `techniques`, `query`). Each file must pass the read-only policy; files that do not are reported by `list_hunting_queries` and not loaded.

```json
"env": {
  "AZURE_TENANT_ID": "<tenant-id>",
  "AZURE_QUERY_MCP_HUNTING_DIR": "/path/to/SentinelCBContent/Hunting"
}
```

### Prompts

| Prompt | Workflow |
| --- | --- |
| `triage_incident` | `get_incident`, then `entity_timeline` for the key entities, then a verdict with evidence and next steps. |
| `ingestion_health_review` | `check_ingestion_health`, likely causes for each problem, and which detections would go blind. |

### Query correctness

The test suite parses and semantically analyses every built-in query with Microsoft's Kusto language service against a snapshot of the official Azure Monitor table schemas (`test/fixtures/table-schemas.json`, refreshed with `node scripts/update-table-schemas.mjs`). An unknown table, column or function fails CI.

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
| Server is not visible in VS Code | Check that `npx` is on the PATH VS Code uses (or, from source, run `npm run build` and verify the absolute `dist/index.js` path), then restart the MCP server or reload VS Code. |
| `evaluate` plugin rejected | Only row-reshaping plugins are allowed; see [Security properties](#security-properties) for the list. |

## Development

```bash
npm run check
npm audit --omit=dev
```

### Releasing

1. Bump `version` in `package.json` (for example `npm version minor --no-git-tag-version`) and update [CHANGELOG.md](CHANGELOG.md).
2. Merge to `main`, then tag the merge commit: `git tag v0.3.0 && git push origin v0.3.0`.
3. The [Release workflow](.github/workflows/release.yml) checks that the tag matches `package.json`, runs the full check and audit, and publishes to npm with provenance using trusted publishing (no stored npm token).

The implementation follows the Microsoft Learn [Azure Resource Graph REST API](https://learn.microsoft.com/azure/governance/resource-graph/first-query-rest-api) and [Resources API reference](https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources?view=rest-azureresourcegraph-resourcegraph-2024-04-01).

## License

[MIT](LICENSE)
