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

test("rejects unbounded queries", () => {
  assert.throws(
    () => validateQuery("SecurityEvent | where TimeGenerated > ago(1h)"),
    /must include/,
  );
});

test("rejects management commands", () => {
  assert.throws(() => validateQuery(".show tables | take 10"), /read-only/);
});

test("rejects dangerous operators", () => {
  assert.throws(
    () => validateQuery("SecurityEvent | evaluate python(typeof(*), 'x') | take 10"),
    /read-only/,
  );
});