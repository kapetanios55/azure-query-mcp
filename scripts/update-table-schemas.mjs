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

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

function cellText(html) {
  // Strip tags until none remain, then decode entities in a single pass so an
  // encoded entity such as &amp;lt; is never decoded twice.
  let text = html;
  for (let previous; previous !== text;) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  }
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => entities[name]).trim();
}

// Column names and types are written into KQL schema strings by the test, so only
// accept plain identifiers and known Kusto scalar types.
const columnName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const scalarTypes = new Set(["bool", "datetime", "dynamic", "guid", "int", "long", "real", "string", "timespan", "decimal"]);

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
      .map(([, row]) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, cell]) => cellText(cell)));
    if (rows[0]?.[0] === "Column" && rows[0]?.[1] === "Type") {
      schemas[table] = rows.slice(1).filter((row) => row.length >= 2).map(([column, rawType]) => {
        const type = rawType.toLowerCase();
        if (!columnName.test(column) || !scalarTypes.has(type)) {
          throw new Error(`${table}: unexpected column '${column}' of type '${rawType}'`);
        }
        return [column, type];
      });
    }
  }
  if (!schemas[table]?.length) {
    throw new Error(`${table}: no column table found at ${url}`);
  }
  console.log(`${table}: ${schemas[table].length} columns`);
}

writeFileSync(new URL("../test/fixtures/table-schemas.json", import.meta.url), `${JSON.stringify(schemas, null, 1)}\n`);
