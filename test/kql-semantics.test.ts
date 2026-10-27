import assert from "node:assert/strict";
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

import { semanticErrors } from "./kusto-analyzer.js";

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
