# Azure Query

Read-only access to Azure Log Analytics, Microsoft Sentinel and Azure Resource Graph for Claude. Ask in plain language and Claude runs the right query: triage a Sentinel incident, build a timeline for an account, IP or host, check whether security logs are still arriving, run MITRE ATT&CK-mapped threat hunts, write and fix KQL, or inventory resources, role assignments, policy compliance and recent changes across subscriptions.

## Install

In Claude Code v2.1.275 or later:

```text
/plugin install azure-query --marketplace kapetanios55/azure-query-mcp
```

Then sign in to Azure (`az login --tenant <tenant-id>`) and ask, for example, "List the open high-severity Sentinel incidents in workspace <workspace-id>."

## What it installs

- **The azure-query MCP server**, run with `npx -y @akapetaniou/azure-query-mcp@0.6.1`, pinned to an exact npm release with build provenance. Its source is in the [azure-query-mcp repository](https://github.com/kapetanios55/azure-query-mcp).
- **The azure-query skill**, which tells Claude which tool fits which question, the query rules the server enforces, how to recover from errors, and safety rules for handling log data.

## What it runs and connects to

The server runs on your machine and signs in with your own Azure identity through `DefaultAzureCredential`, for example your `az login` session. It can read only what your Azure RBAC allows, and every tool is read-only.

It connects to Microsoft Entra ID, Azure Resource Manager (including Resource Graph) and the Log Analytics query API, plus the local managed identity endpoint when the credential chain tries it. `npx` downloads the package from the npm registry on first use. There is no telemetry, and query results are not stored.

## Requirements

- Node.js 22 or later, for `npx`.
- An Azure sign-in, such as `az login --tenant <tenant-id>`.
- `Reader` on the subscriptions to inventory, and `Log Analytics Reader` on the workspaces to query.

## Settings

All settings are optional. Change them with `/plugin configure azure-query@azure-query-mcp`.

| Setting | Effect |
| --- | --- |
| Microsoft Entra tenant ID | Tenant to sign in to. Empty uses the tenant of your current sign-in. |
| Hunting query folder | Folder of your own JSON hunting queries, loaded alongside the built-in hunts. |
| Azure cloud | `AzurePublicCloud` (default), `AzureUSGovernment` or `AzureChinaCloud`. |
| Allow cross-resource queries | Lets a query read other workspaces, apps, Data Explorer clusters or Resource Graph through `workspace()`, `adx()` and similar functions. Off by default. |

Full documentation, security notes and troubleshooting: [azure-query-mcp README](https://github.com/kapetanios55/azure-query-mcp#readme) and [SECURITY.md](https://github.com/kapetanios55/azure-query-mcp/blob/main/SECURITY.md).

## License

MIT
