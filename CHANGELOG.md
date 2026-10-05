# Changelog

## 0.3.0

- Published to npm as `@kapetanios55/azure-query-mcp`; run with `npx -y @kapetanios55/azure-query-mcp`.
- Query policy now ignores string literals and comments, fixing false rejections of common hunting queries such as `where OperationName has "delete"`.
- `evaluate` is allowed for row-reshaping plugins (`autocluster`, `bag_unpack`, `basket`, `diffpatterns`, `ipv4_lookup`, `ipv6_lookup`, `narrow`, `pivot`, `preview`); plugins that reach outside the workspace remain blocked.
- `top N` is accepted as a result limit, as the documentation already stated.
- Unterminated string literals are rejected (fail closed).
- Added a tag-triggered release workflow that publishes with npm provenance via trusted publishing.
- README: badges and setup snippets for VS Code, Claude Desktop, Cursor and Claude Code.

## 0.2.0

- Initial read-only Log Analytics and Azure Resource Graph tools.
