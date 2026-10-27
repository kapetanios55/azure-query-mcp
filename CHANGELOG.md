# Changelog

## Unreleased

- Workspace tools accept the workspace's full ARM resource ID as well as its workspace ID (GUID). The server resolves a resource ID through Azure Resource Manager once and caches it. `search_tables` and `describe_table` still need the resource ID, and now say so when given a GUID.
- Timespans accept absolute ISO 8601 intervals (`start/end`, `start/duration`, `duration/end`) as well as durations. Times must carry `Z` or an offset, and impossible dates are rejected. `check_ingestion_health` keeps durations only, because it measures against now.
- Cancelling a tool call aborts its Azure requests: Log Analytics queries, Resource Manager calls, Resource Graph and token requests. `@azure/monitor-query-logs` 1.0.0 drops `abortSignal` from query options, so a pipeline policy attaches the signal instead.
- Cross-resource query functions (`workspace()`, `app()`, `resource()`, `adx()`, `arg()`, `cluster()`, `database()`) are rejected by default, so each query reads only the workspace it is sent to. Set `AZURE_QUERY_MCP_ALLOW_CROSS_RESOURCE=true` to allow them. **Behaviour change:** queries and hunting files that use these functions need the setting.
- Azure Government and Azure China: `AZURE_QUERY_MCP_CLOUD` selects the cloud for Resource Manager, Resource Graph, Log Analytics and the token authority. An unknown value stops the server rather than falling back to the public cloud.
- Both services share one credential and token cache.
- The Claude Code plugin gains `cloud` and `allow_cross_resource` settings.

## 0.5.0 (2026-10-27)

- Claude Code plugin and marketplace (`.claude-plugin/`): `/plugin install azure-query --marketplace kapetanios55/azure-query-mcp` installs the MCP server, pinned to the matching npm release, together with the agent skill. The tenant ID and hunting-query folder are prompted for as plugin settings. The plugin has an icon (`.claude-plugin/icon.png`).
- Agent skill `skills/azure-query` (Agent Skills format) that tells agents when and how to use each tool: workspace identifiers, the KQL rules the server enforces, error recovery, SOC workflows and safety rules, with tested example queries for Log Analytics and Resource Graph. CI validates the skill and every example query.
- Security: update `@modelcontextprotocol/server` to 2.4.0, `zod` to 4.6.7 and `@azure/identity` to 4.14.0, and pin `@azure/msal-node` to 7.1.1 or later through `overrides`, clearing every high-severity `npm audit` finding (GHSA-jm63-cq47-j5jp, GHSA-46jr-4wx8-v453, GHSA-rvq5-wwqv-78pq, GHSA-mrhx-c7xc-m3w5, GHSA-xcx6-jx8p-x3h5).
- Query errors are actionable: when Log Analytics, ARM or Resource Graph rejects a request with HTTP 400, the tool returns the most specific service message (for example `SEM0100: 'where' operator: Failed to resolve column ...`) instead of a generic failure. Authentication, authorization, not-found, throttling, network and credential-chain failures return a specific fix hint; upstream messages for those are still withheld.
- `query_azure_resources` accepts every ARG table, including `ResourceChanges`, `ResourceContainerChanges`, `AppServiceResources` and `TagsResources`. Sending a Log Analytics table now points to `query_workspace`.
- An unreadable `AZURE_QUERY_MCP_HUNTING_DIR` no longer stops the server from starting; it is reported in `list_hunting_queries` `loadErrors`.
- Tool results are compact JSON, and `query_workspace` returns `executionTimeSeconds` instead of the full query statistics payload, which cuts the tokens each call costs.

## 0.4.0 (2026-10-05)

- SOC tools: `list_incidents`, `get_incident` (with pivot entities), `entity_timeline`, `check_ingestion_health`, `list_hunting_queries` and `run_hunting_query`.
- Built-in hunting library mapped to MITRE ATT&CK, plus `AZURE_QUERY_MCP_HUNTING_DIR` for SentinelCBContent-format JSON hunts.
- MCP prompts: `triage_incident` and `ingestion_health_review`.
- CI semantically analyses every built-in query with Microsoft's Kusto language service against the official table schemas.

## 0.3.0 (not published separately; included in 0.4.0)

- Published to npm as `@akapetaniou/azure-query-mcp`; run with `npx -y @akapetaniou/azure-query-mcp`.
- Query policy now ignores string literals and comments, fixing false rejections of common hunting queries such as `where OperationName has "delete"`.
- `evaluate` is allowed for row-reshaping plugins (`autocluster`, `bag_unpack`, `basket`, `diffpatterns`, `ipv4_lookup`, `ipv6_lookup`, `narrow`, `pivot`, `preview`); plugins that reach outside the workspace remain blocked.
- `top N` is accepted as a result limit, as the documentation already stated.
- Unterminated string literals are rejected (fail closed).
- Added a tag-triggered release workflow that publishes with npm provenance via trusted publishing.
- README: badges and setup snippets for VS Code, Claude Desktop, Cursor and Claude Code.

## 0.2.0

- Initial read-only Log Analytics and Azure Resource Graph tools.
