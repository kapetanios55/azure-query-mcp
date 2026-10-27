# Changelog

## Unreleased

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
