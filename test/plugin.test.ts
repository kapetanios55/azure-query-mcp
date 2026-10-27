import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The Claude Code plugin (.claude-plugin/) runs a pinned npm release of this server.
// These checks keep the pin, the plugin version and the package version in step, so a
// release cannot ship a plugin that installs a different server than it was tested with.
// `claude plugin validate . --strict` covers the manifest schema itself.
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const pkg = readJson("../package.json") as { name: string; version: string };
const plugin = readJson("../.claude-plugin/plugin.json") as {
  name: string;
  version: string;
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  userConfig?: Record<string, { default?: unknown }>;
};
const marketplace = readJson("../.claude-plugin/marketplace.json") as { plugins: Array<{ name: string; source: string }> };

test("the plugin version matches the package version", () => {
  assert.equal(plugin.version, pkg.version);
});

test("the plugin runs exactly this package version through npx", () => {
  const server = plugin.mcpServers["azure-query"];
  assert.ok(server, "plugin must declare the azure-query MCP server");
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args, ["-y", `${pkg.name}@${pkg.version}`]);
});

test("every user_config reference is declared with a default the server reads as unset", () => {
  const server = plugin.mcpServers["azure-query"];
  const references = Object.values(server?.env ?? {}).flatMap((value) => [...value.matchAll(/\$\{user_config\.(\w+)\}/g)].map((match) => match[1] ?? ""));
  assert.ok(references.length > 0);
  for (const key of references) {
    // Unset options reach the server as "" (strings) or "false" (booleans); it treats both as not configured.
    const fallback = plugin.userConfig?.[key]?.default;
    assert.ok(fallback === "" || fallback === false, `${key} must default to "" or false`);
  }
});

test("the marketplace lists the plugin from the repository root", () => {
  assert.deepEqual(marketplace.plugins.map(({ name, source }) => ({ name, source })), [{ name: plugin.name, source: "./" }]);
});

test("the README install examples pin the package version", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const pins = [...readme.matchAll(/@akapetaniou\/azure-query-mcp@([\w.-]+)/g)].map((match) => match[1]);
  assert.ok(pins.length >= 3, "the claude mcp add, VS Code and Claude Desktop examples pin a version");
  assert.deepEqual([...new Set(pins)], [pkg.version], "update the README pins when the version changes");
});
