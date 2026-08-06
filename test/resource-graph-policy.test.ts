import assert from "node:assert/strict";
import test from "node:test";

import { validateResourceGraphQuery } from "../src/resource-graph-policy.js";

test("accepts resource inventory queries", () => {
  assert.doesNotThrow(() => validateResourceGraphQuery("Resources | project id, name, type | limit 10"));
});

test("rejects Log Analytics table queries", () => {
  assert.throws(
    () => validateResourceGraphQuery("Heartbeat | take 10"),
    /supported ARG table/,
  );
});

test("rejects management commands and external data", () => {
  assert.throws(() => validateResourceGraphQuery(".show tables"), /supported ARG table/);
  assert.throws(
    () => validateResourceGraphQuery("Resources | externaldata(value:string)['https://example.com']"),
    /read-only/,
  );
});