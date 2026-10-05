import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { builtInHuntingQueries } from "../src/hunting-library.js";
import {
  entityTimelineQuery,
  entityTimelineSummaryQuery,
  incidentAlertsQuery,
  incidentDetailQuery,
  ingestionLatencyQuery,
  ingestionVolumeQuery,
  listIncidentsQuery,
} from "../src/soc-queries.js";

// Microsoft's Kusto language service (the parser behind Azure Data Explorer and Log
// Analytics) resolves every table, column and function in the built-in queries against
// a snapshot of the official table schemas (scripts/update-table-schemas.mjs).
const require = createRequire(import.meta.url);
require("@kusto/language-service-next/bridge.js");
require("@kusto/language-service-next/Kusto.Language.Bridge.js");
const Kusto = (globalThis as any).Kusto.Language;

const schemas = JSON.parse(
  readFileSync(new URL("./fixtures/table-schemas.json", import.meta.url), "utf8"),
) as Record<string, Array<[string, string]>>;

const tables = Object.entries(schemas).map(([name, columns]) =>
  Kusto.Symbols.TableSymbol.From(`(${columns.map(([column, type]) => `['${column}']:${type.toLowerCase()}`).join(", ")})`).WithName(name),
);
const globals = Kusto.GlobalState.Default.WithDatabase(new Kusto.Symbols.DatabaseSymbol.$ctor1("Workspace", tables));

function semanticErrors(query: string): string[] {
  const diagnostics = Kusto.KustoCode.ParseAndAnalyze(query, globals).GetDiagnostics();
  const errors: string[] = [];
  for (let index = 0; index < diagnostics.Count; index += 1) {
    const diagnostic = diagnostics.getItem(index);
    if (String(diagnostic.Severity) === "Error") {
      errors.push(`${diagnostic.Message} at "${query.substr(diagnostic.Start, Math.max(diagnostic.Length, 12))}"`);
    }
  }
  return errors;
}

const queries: Record<string, string> = {
  "timeline account": entityTimelineQuery("account", "alice@contoso.com", 200),
  "timeline ip": entityTimelineQuery("ip", "203.0.113.7", 200),
  "timeline host": entityTimelineQuery("host", "web-01", 200),
  "timeline summary account": entityTimelineSummaryQuery("account", "alice@contoso.com"),
  "timeline summary ip": entityTimelineSummaryQuery("ip", "2001:db8::1"),
  "timeline summary host": entityTimelineSummaryQuery("host", "web-01.corp.contoso.com"),
  "list incidents": listIncidentsQuery({ statuses: ["New", "Active"], severities: ["High"], maxResults: 50 }),
  "incident detail": incidentDetailQuery(12),
  "incident alerts": incidentAlertsQuery(12),
  "ingestion volume": ingestionVolumeQuery(24),
  "ingestion latency": ingestionLatencyQuery(),
  ...Object.fromEntries(builtInHuntingQueries.map((hunt) => [`hunt ${hunt.id}`, hunt.query])),
};

test("the analyzer reports unknown columns (guards against a vacuous pass)", () => {
  assert.notDeepEqual(semanticErrors("SigninLogs | where NoSuchColumn == 1 | take 1"), []);
});

for (const [name, query] of Object.entries(queries)) {
  test(`built-in KQL resolves against official table schemas: ${name}`, () => {
    assert.deepEqual(semanticErrors(query), []);
  });
}
