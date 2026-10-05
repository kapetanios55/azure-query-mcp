import assert from "node:assert/strict";
import test from "node:test";

import { validateQuery } from "../src/query-policy.js";

test("accepts bounded read-only queries", () => {
  assert.doesNotThrow(() =>
    validateQuery("SecurityEvent | where TimeGenerated > ago(1h) | take 50"),
  );
});

test("accepts aggregate queries", () => {
  assert.doesNotThrow(() =>
    validateQuery("SigninLogs | summarize Failures=count() by UserPrincipalName"),
  );
});

test("accepts top as a result limit", () => {
  assert.doesNotThrow(() =>
    validateQuery("SigninLogs | top 10 by TimeGenerated desc"),
  );
});

test("rejects unbounded queries", () => {
  assert.throws(
    () => validateQuery("SecurityEvent | where TimeGenerated > ago(1h)"),
    /must include/,
  );
});

test("rejects management commands", () => {
  assert.throws(() => validateQuery(".show tables | take 10"), /read-only/);
});

test("rejects plugins that reach outside the workspace", () => {
  assert.throws(
    () => validateQuery("SecurityEvent | evaluate python(typeof(*), 'x') | take 10"),
    /'python' is not allowed/,
  );
  assert.throws(
    () => validateQuery("print 1 | evaluate http_request('https://example.com') | take 1"),
    /'http_request' is not allowed/,
  );
});

test("rejects externaldata and set statements", () => {
  assert.throws(
    () => validateQuery("externaldata(x:string) [@'https://example.com/a.csv'] | take 10"),
    /read-only/,
  );
  assert.throws(
    () => validateQuery("set notruncation; SecurityEvent | take 10"),
    /read-only/,
  );
});

test("accepts keywords that only appear inside string literals", () => {
  const queries = [
    'AzureActivity | where OperationNameValue has "delete" | take 50',
    "AuditLogs | where OperationName == 'Delete user' | take 20",
    'Syslog | where SyslogMessage has_any ("drop", "purge", "append") | take 10',
    'SecurityEvent | where CommandLine has @"C:\\set\\ingest" | take 10',
    "AzureActivity | where Properties has ```delete\nset``` | take 5",
  ];
  for (const query of queries) {
    assert.doesNotThrow(() => validateQuery(query), query);
  }
});

test("accepts keywords that only appear in comments", () => {
  assert.doesNotThrow(() =>
    validateQuery("// find failed delete operations\nAzureActivity\n| where ActivityStatusValue == 'Failure'\n| take 10"),
  );
});

test("accepts allow-listed evaluate plugins", () => {
  assert.doesNotThrow(() =>
    validateQuery("SigninLogs | take 100 | evaluate bag_unpack(LocationDetails)"),
  );
  assert.doesNotThrow(() =>
    validateQuery("SecurityAlert | summarize count() by AlertName, Severity | evaluate autocluster()"),
  );
});

test("does not count a result limit hidden inside a string", () => {
  assert.throws(
    () => validateQuery('SecurityEvent | where Activity has "| take 10"'),
    /must include/,
  );
});

test("fails closed on unterminated string literals", () => {
  assert.throws(
    () => validateQuery('SecurityEvent | where Account has "admin | take 10'),
    /unterminated/,
  );
});

test("still catches management commands placed after a string literal", () => {
  assert.throws(
    () => validateQuery('print "harmless" | take 1;\n.drop table SecurityEvent'),
    /read-only/,
  );
});
