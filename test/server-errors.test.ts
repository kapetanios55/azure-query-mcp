import assert from "node:assert/strict";
import test from "node:test";

import { safeErrorMessage } from "../src/server.js";

test("preserves safe validation errors", () => {
  assert.equal(
    safeErrorMessage(new Error("KQL query must include take, limit, summarize, or count.")),
    "KQL query must include take, limit, summarize, or count.",
  );
});

test("redacts unexpected upstream error details", () => {
  assert.equal(
    safeErrorMessage(new Error("Token issuer contains tenant 11111111-1111-1111-1111-111111111111")),
    "Request failed. Verify the inputs, Azure authentication, RBAC, and service availability.",
  );
});