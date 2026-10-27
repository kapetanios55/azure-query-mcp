import assert from "node:assert/strict";
import test from "node:test";

import { validateResourceGraphQuery } from "../src/resource-graph-policy.js";

test("accepts resource inventory queries", () => {
  assert.doesNotThrow(() => validateResourceGraphQuery("Resources | project id, name, type | limit 10"));
});

test("accepts change and service-specific ARG tables", () => {
  for (const table of ["ResourceChanges", "resourcecontainerchanges", "ResourceContainers", "AppServiceResources", "TagsResources", "NetworkResourceChanges"]) {
    assert.doesNotThrow(() => validateResourceGraphQuery(`${table} | limit 10`), table);
  }
});

test("rejects Log Analytics table queries and points to query_workspace", () => {
  for (const query of ["Heartbeat | take 10", "SigninLogs | take 10", "SecurityIncident | take 10"]) {
    assert.throws(() => validateResourceGraphQuery(query), /supported ARG table.*query_workspace/, query);
  }
});

test("accepts keywords inside string literals and leading comments", () => {
  assert.doesNotThrow(() =>
    validateResourceGraphQuery("// resources pending deletion\nResources | where tags['lifecycle'] == 'delete' | limit 10"),
  );
});

test("rejects management commands and external data", () => {
  assert.throws(() => validateResourceGraphQuery(".show tables"), /supported ARG table/);
  assert.throws(
    () => validateResourceGraphQuery("Resources | externaldata(value:string)['https://example.com']"),
    /read-only/,
  );
});