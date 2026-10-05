#!/usr/bin/env node
// Live, read-only exercise of every tool over MCP stdio against a real workspace.
// Prints sanitised summaries (counts, statuses, timings), never raw records, so the
// output is safe to paste into an issue or PR.
//
// Usage (after `npm run build` and `az login`):
//   node scripts/live-smoke-test.mjs <repo-dir> <subscription-id> <workspace-resource-id> <workspace-customer-id>
import { spawn } from "node:child_process";

const [repo, subscriptionId, workspaceResourceId, workspaceId] = process.argv.slice(2);
const server = spawn(process.execPath, [`${repo}/dist/index.js`], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
});
let stderr = "";
server.stderr.on("data", (d) => { stderr += d; });

let nextId = 1;
const pending = new Map();
let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 240_000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
});
async function call(name, args) {
  const started = Date.now();
  const response = await rpc("tools/call", { name, arguments: args });
  const text = response.result?.content?.[0]?.text ?? JSON.stringify(response.error);
  const ms = Date.now() - started;
  if (response.result?.isError) return { ok: false, ms, error: text };
  try { return { ok: true, ms, data: JSON.parse(text) }; } catch { return { ok: true, ms, data: text }; }
}
const line = (label, result, summary) =>
  console.log(`${result.ok ? "PASS" : "FAIL"} ${label.padEnd(34)} ${String(result.ms).padStart(6)}ms  ${result.ok ? summary(result.data) : result.error}`);

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "live-test", version: "0" } });
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

let r = await call("list_workspaces", { subscriptionId });
line("list_workspaces", r, (d) => `${d.length} workspaces; target workspace found: ${d.some((w) => w.workspaceId === workspaceId)}`);

r = await call("search_tables", { workspaceResourceId, search: "Security" });
line("search_tables(Security)", r, (d) => `${d.length} tables`);

r = await call("describe_table", { workspaceResourceId, tableName: "SecurityIncident" });
line("describe_table(SecurityIncident)", r, (d) => `${d.columns?.length} columns, retention ${d.retentionInDays}d`);

r = await call("query_workspace", { workspaceId, timespan: "P7D", query: 'AzureActivity | where OperationNameValue has "delete" | summarize count()' });
line("query_workspace('delete' in string)", r, (d) => `status ${d.status}, rows ${d.tables?.[0]?.returnedRows}`);

r = await call("query_azure_resources", { subscriptionIds: [subscriptionId], query: "Resources | summarize count() by type | top 5 by count_" });
line("query_azure_resources", r, (d) => `${d.data?.length ?? d.count ?? "?"} rows`);

r = await call("list_incidents", { workspaceId, timespan: "P30D", maxResults: 20 });
line("list_incidents(P30D)", r, (d) => `${d.count} incidents; severities ${JSON.stringify(Object.entries(d.incidents.reduce((a, i) => ({ ...a, [i.Severity]: (a[i.Severity] ?? 0) + 1 }), {})))}`);
const candidates = r.ok ? r.data.incidents.filter((i) => (i.AlertCount ?? 0) > 0).slice(0, 12) : [];
let pivots = [];
let unresolvedTotal = 0;
for (const [index, incident] of candidates.entries()) {
  const g = await call("get_incident", { workspaceId, incidentNumber: incident.IncidentNumber, timespan: "P30D" });
  if (index === 0) line(`get_incident(#${incident.IncidentNumber})`, g, (d) => `${d.alerts.length} alerts; pivots ${d.pivotEntities.length}, unresolved ${d.unresolvedEntities.length}`);
  if (!g.ok) continue;
  unresolvedTotal += g.data.unresolvedEntities.length;
  for (const p of g.data.pivotEntities) if (!pivots.some((x) => x.type === p.type)) pivots.push(p);
  if (["account", "ip", "host"].every((t) => pivots.some((p) => p.type === t))) break;
}
console.log(`INFO scanned incidents for pivots        found types: ${pivots.map((p) => p.type).join(", ") || "none"}; unresolved entities seen: ${unresolvedTotal}`);

for (const type of ["account", "ip", "host"]) {
  const pivot = pivots.find((p) => p.type === type);
  if (!pivot) { console.log(`SKIP entity_timeline(${type})              no ${type} pivot entity available`); continue; }
  r = await call("entity_timeline", { workspaceId, entityType: type, entity: pivot.value, timespan: "P7D", maxEvents: 50 });
  line(`entity_timeline(${type})`, r, (d) => `${d.totalEvents} events across ${d.sources.length} sources (${d.sources.map((s) => s.Source).join(", ")}); returned ${d.returnedEvents}`);
}

r = await call("check_ingestion_health", { workspaceId, timespan: "P7D", staleAfterHours: 24 });
line("check_ingestion_health(P7D)", r, (d) => `${d.summary.tables} tables; stale ${d.summary.stale.length}, drops ${d.summary.volumeDrops.length}, spikes ${d.summary.volumeSpikes.length}, delayed ${d.summary.delayedOver15Min.length}; latency sample ${d.latencyLastHour.length} tables`);

r = await call("list_hunting_queries", {});
line("list_hunting_queries", r, (d) => `${d.queries.length} queries, ${d.loadErrors.length} load errors`);
for (const hunt of r.ok ? r.data.queries : []) {
  const h = await call("run_hunting_query", { workspaceId, queryId: hunt.id, timespan: "P7D" });
  line(`run_hunting_query(${hunt.id})`, h, (d) => `${d.resultCount} results`);
}

r = await call("entity_timeline", { workspaceId, entityType: "account", entity: 'x" or 1==1 //' });
line("entity_timeline(injection attempt)", { ...r, ok: !r.ok, error: r.ok ? "NOT REJECTED" : r.error }, () => r.error);

server.kill();
if (stderr.trim()) console.log(`\nserver stderr (first 400 chars): ${stderr.slice(0, 400)}`);
