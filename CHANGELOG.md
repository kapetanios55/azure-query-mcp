# Changelog

## 0.4.0 (unreleased)

- SOC tools: `list_incidents`, `get_incident` (with pivot entities), `entity_timeline`, `check_ingestion_health`, `list_hunting_queries` and `run_hunting_query`.
- Built-in hunting library mapped to MITRE ATT&CK, plus `AZURE_QUERY_MCP_HUNTING_DIR` for SentinelCBContent-format JSON hunts.
- MCP prompts: `triage_incident` and `ingestion_health_review`.
- CI semantically analyses every built-in query with Microsoft's Kusto language service against the official table schemas.

## 0.3.0

- Published to npm as `@akapetaniou/azure-query-mcp`; run with `npx -y @akapetaniou/azure-query-mcp`.
- Query policy now ignores string literals and comments, fixing false rejections of common hunting queries such as `where OperationName has "delete"`.
- `evaluate` is allowed for row-reshaping plugins (`autocluster`, `bag_unpack`, `basket`, `diffpatterns`, `ipv4_lookup`, `ipv6_lookup`, `narrow`, `pivot`, `preview`); plugins that reach outside the workspace remain blocked.
- `top N` is accepted as a result limit, as the documentation already stated.
- Unterminated string literals are rejected (fail closed).
- Added a tag-triggered release workflow that publishes with npm provenance via trusted publishing.
- README: badges and setup snippets for VS Code, Claude Desktop, Cursor and Claude Code.

## 0.2.0

- Initial read-only Log Analytics and Azure Resource Graph tools.
