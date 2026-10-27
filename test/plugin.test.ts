import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

// The Claude Code plugin (plugin/) runs a pinned npm release of this server.
// These checks keep the pin, the plugin version and the package version in step, so a
// release cannot ship a plugin that installs a different server than it was tested with.
// `claude plugin validate ./plugin --strict` covers the manifest schema itself.
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const pkg = readJson("../package.json") as { name: string; version: string };
const plugin = readJson("../plugin/.claude-plugin/plugin.json") as {
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

test("the marketplace lists the plugin from its own folder", () => {
  assert.deepEqual(marketplace.plugins.map(({ name, source }) => ({ name, source })), [{ name: plugin.name, source: "./plugin" }]);
});

test("the README install examples pin the package version", () => {
  const pinsIn = (path: string) =>
    [...readFileSync(new URL(path, import.meta.url), "utf8").matchAll(/@akapetaniou\/azure-query-mcp@([\w.-]+)/g)].map((match) => match[1]);
  const readmePins = pinsIn("../README.md");
  assert.ok(readmePins.length >= 3, "the claude mcp add, VS Code and Claude Desktop examples pin a version");
  assert.deepEqual([...new Set([...readmePins, ...pinsIn("../plugin/README.md")])], [pkg.version], "update the README pins when the version changes");
});

test("the plugin folder holds only what the plugin needs", () => {
  // A package.json beside a lockfile makes Claude Code try to install the server's own
  // dependencies into every user's plugin cache; the plugin runs the server through npx instead.
  for (const file of ["package.json", "package-lock.json", "npm-shrinkwrap.json", "bun.lock"]) {
    assert.ok(!existsSync(new URL(`../plugin/${file}`, import.meta.url)), `plugin/${file} must not exist`);
  }
  const readme = readFileSync(new URL("../plugin/README.md", import.meta.url), "utf8").replace(/```[\s\S]*?```/g, "");
  assert.ok(readme.split(/\s+/).filter(Boolean).length >= 40, "the directory needs a plugin README of at least 40 words outside code blocks");
  assert.equal((plugin as { license?: string }).license, "MIT");
});
