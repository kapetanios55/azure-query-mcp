import assert from "node:assert/strict";
import test from "node:test";

import { safeErrorMessage } from "../src/server.js";

test("preserves safe validation errors", () => {
  assert.equal(
    safeErrorMessage(new Error("KQL query must include take, limit, summarize, or count.")),
    "KQL query must include take, limit, summarize, or count.",
  );
});

test("preserves query policy errors so the client can correct the query", () => {
  for (const message of [
    "The evaluate plugin 'python' is not allowed. Allowed plugins: autocluster, bag_unpack.",
    "KQL query contains an unterminated string literal.",
  ]) {
    assert.equal(safeErrorMessage(new Error(message)), message);
  }
});

test("redacts unexpected upstream error details", () => {
  assert.equal(
    safeErrorMessage(new Error("Token issuer contains tenant 11111111-1111-1111-1111-111111111111")),
    "Request failed. Verify the inputs, Azure authentication, RBAC, and service availability.",
  );
});