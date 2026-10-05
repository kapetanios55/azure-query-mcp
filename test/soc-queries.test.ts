import assert from "node:assert/strict";
import test from "node:test";

import { validateQuery } from "../src/query-policy.js";
import {
  entityTimelineQuery,
  entityTimelineSummaryQuery,
  incidentAlertsQuery,
  incidentDetailQuery,
  ingestionLatencyQuery,
  ingestionVolumeQuery,
  listIncidentsQuery,
  validateEntity,
} from "../src/soc-queries.js";

const builtInPolicy = { maxLength: 10_000, requireResultLimit: false };

test("accepts well-formed entities", () => {
  assert.equal(validateEntity("account", " alice@contoso.com "), "alice@contoso.com");
  assert.equal(validateEntity("account", "svc_backup"), "svc_backup");
  assert.equal(validateEntity("ip", "203.0.113.7"), "203.0.113.7");
  assert.equal(validateEntity("ip", "2001:db8::1"), "2001:db8::1");
  assert.equal(validateEntity("host", "web-01.corp.contoso.com"), "web-01.corp.contoso.com");
});

test("rejects entity values that could break out of a KQL string", () => {
  const attempts: Array<["account" | "ip" | "host", string]> = [
    ["account", 'alice" or 1==1 //'],
    ["account", "alice@contoso.com\" | take 1"],
    ["account", "alice\\@contoso.com"],
    ["ip", "203.0.113.7\" or true"],
    ["ip", "999.1.1.1"],
    ["host", "web01\"; .drop table x"],
    ["host", "web 01"],
  ];
  for (const [type, value] of attempts) {
    assert.throws(() => validateEntity(type, value), /Entity value is not/, `${type}: ${value}`);
    assert.throws(() => entityTimelineQuery(type, value, 10), /Entity value is not/);
  }
});

test("timeline queries cover the expected sources and pass the read-only policy", () => {
  const expected = {
    account: ["SigninLogs", "AuditLogs", "OfficeActivity", "DeviceLogonEvents", "SecurityAlert"],
    ip: ["SigninLogs", "AzureActivity", "OfficeActivity", "DeviceNetworkEvents", "CommonSecurityLog", "SecurityAlert"],
    host: ["DeviceProcessEvents", "DeviceLogonEvents", "DeviceNetworkEvents", "SecurityEvent", "SecurityAlert"],
  } as const;
  const values = { account: "alice@contoso.com", ip: "203.0.113.7", host: "web-01" } as const;

  for (const type of ["account", "ip", "host"] as const) {
    const events = entityTimelineQuery(type, values[type], 150);
    const summary = entityTimelineSummaryQuery(type, values[type]);
    assert.match(events, /^union isfuzzy=true/);
    assert.match(events, /\| take 150$/);
    assert.match(summary, /summarize Events = count\(\)/);
    for (const table of expected[type]) {
      assert.ok(events.includes(`${table} | where`), `${type} timeline missing ${table}`);
    }
    assert.doesNotThrow(() => validateQuery(events, builtInPolicy));
    assert.doesNotThrow(() => validateQuery(summary, builtInPolicy));
  }
});

test("incident queries filter on allowed values only", () => {
  const query = listIncidentsQuery({ statuses: ["New", "Active"], severities: ["High"], maxResults: 25 });
  assert.match(query, /arg_max\(TimeGenerated, \*\) by IncidentNumber/);
  assert.match(query, /where Status in~ \("New", "Active"\)/);
  assert.match(query, /where Severity in~ \("High"\)/);
  assert.match(query, /take 25$/);
  assert.doesNotThrow(() => validateQuery(query));

  assert.doesNotMatch(listIncidentsQuery({ maxResults: 5 }), /where Status/);
  assert.throws(
    () => listIncidentsQuery({ statuses: ['New") | union (x'], maxResults: 5 }),
    /not allowed for Status/,
  );
});

test("incident detail queries require a positive integer", () => {
  assert.match(incidentDetailQuery(42), /IncidentNumber == 42/);
  assert.match(incidentAlertsQuery(42), /SystemAlertId in \(alertIds\)/);
  assert.throws(() => incidentDetailQuery(0), /positive integer/);
  assert.throws(() => incidentAlertsQuery(1.5), /positive integer/);
  assert.doesNotThrow(() => validateQuery(incidentAlertsQuery(7)));
});

test("ingestion queries pass the read-only policy", () => {
  const volume = ingestionVolumeQuery(12);
  assert.match(volume, /HoursSinceLastSeen > 12, "Stale"/);
  assert.doesNotThrow(() => validateQuery(volume));
  assert.doesNotThrow(() => validateQuery(ingestionLatencyQuery()));
  // Regression: a workspace table with its own TableName column broke withsource=TableName.
  assert.doesNotMatch(ingestionLatencyQuery(), /withsource=TableName/);
});
