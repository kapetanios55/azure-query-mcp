#!/usr/bin/env node
// Refreshes test/fixtures/table-schemas.json from the Azure Monitor table reference on
// Microsoft Learn. The KQL semantics test resolves every built-in query against it.
// Usage: node scripts/update-table-schemas.mjs
import { writeFileSync } from "node:fs";

const tables = [
  "AuditLogs", "AzureActivity", "CommonSecurityLog", "DeviceLogonEvents", "DeviceNetworkEvents",
  "DeviceProcessEvents", "OfficeActivity", "SecurityAlert", "SecurityEvent", "SecurityIncident",
  "SigninLogs", "Usage",
];

const decode = (text) => text
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .trim();

const schemas = {};
for (const table of tables) {
  const url = `https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/${table.toLowerCase()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${table}: HTTP ${response.status} from ${url}`);
  }
  const html = await response.text();
  for (const block of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const rows = [...block.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map(([, row]) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => decode(cell)));
    if (rows[0]?.[0] === "Column" && rows[0]?.[1] === "Type") {
      schemas[table] = rows.slice(1).filter((row) => row.length >= 2).map(([column, type]) => [column, type]);
    }
  }
  if (!schemas[table]?.length) {
    throw new Error(`${table}: no column table found at ${url}`);
  }
  console.log(`${table}: ${schemas[table].length} columns`);
}

writeFileSync(new URL("../test/fixtures/table-schemas.json", import.meta.url), `${JSON.stringify(schemas, null, 1)}\n`);
