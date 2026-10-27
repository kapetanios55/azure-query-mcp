import assert from "node:assert/strict";
import test from "node:test";

import { AggregateAuthenticationError, AuthenticationError, CredentialUnavailableError } from "@azure/identity";

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
function restError(statusCode: number | undefined, message: string, extra: { code?: string; details?: unknown } = {}) {
  return Object.assign(new Error(message), { name: "RestError", statusCode, ...extra });
}

test("passes through the most specific Log Analytics query error so the client can fix the query", () => {
  const error = restError(400, "The request had some invalid properties", {
    code: "BadArgumentError",
    details: {
      error: {
        code: "BadArgumentError",
        message: "The request had some invalid properties",
        innererror: {
          code: "SemanticError",
          message: "A semantic error occurred.",
          innererror: { code: "SEM0100", message: "'where' operator: Failed to resolve column or scalar expression named 'Foo'" },
        },
      },
    },
  });
  assert.equal(
    safeErrorMessage(error),
    "Azure request failed with HTTP 400 (SEM0100): 'where' operator: Failed to resolve column or scalar expression named 'Foo'",
  );
});

test("uses the code and message of a deserialized ARM 400 error", () => {
  const error = restError(400, "Table name 'Bad Name' is invalid.", { code: "InvalidParameter" });
  assert.equal(safeErrorMessage(error), "Azure request failed with HTTP 400 (InvalidParameter): Table name 'Bad Name' is invalid.");
});

test("truncates very long query error details", () => {
  const error = restError(400, "x".repeat(5_000), { code: "BadArgumentError" });
  assert.ok(safeErrorMessage(error).endsWith("...[truncated]"));
  assert.ok(safeErrorMessage(error).length < 1_200);
});

test("gives hints for auth, access and not-found failures without upstream messages", () => {
  const tenantMessage = "The access token is from the wrong issuer 11111111-1111-1111-1111-111111111111";
  const unauthorized = safeErrorMessage(restError(401, tenantMessage, { code: "InvalidAuthenticationTokenTenant" }));
  assert.match(unauthorized, /^Azure request failed with HTTP 401 \(InvalidAuthenticationTokenTenant\)\. .*az login --tenant/);
  assert.doesNotMatch(unauthorized, /11111111/);

  assert.match(safeErrorMessage(restError(403, tenantMessage, { code: "InsufficientAccessError" })), /HTTP 403 \(InsufficientAccessError\)\. .*Log Analytics Reader/);
  assert.match(safeErrorMessage(restError(404, "not found", { code: "ResourceNotFound" })), /HTTP 404 \(ResourceNotFound\)\. .*list_workspaces/);
  assert.match(safeErrorMessage(restError(503, "busy")), /HTTP 503\. Azure returned a server error/);
});

test("ignores a raw response body that was not deserialized into an error", () => {
  // Without a parsed error, core-client puts the raw body text in the message and sets no code.
  assert.equal(safeErrorMessage(restError(400, "<html>sensitive</html>")), "Azure request failed with HTTP 400.");
});

test("drops error codes that are not plain identifiers", () => {
  assert.equal(safeErrorMessage(restError(500, "boom", { code: "not a code: 11111111" })), "Azure request failed with HTTP 500. Azure returned a server error. Retry shortly.");
});

test("explains network and credential failures", () => {
  assert.match(safeErrorMessage(restError(undefined, "getaddrinfo ENOTFOUND api.loganalytics.io", { code: "REQUEST_SEND_ERROR" })), /could not be reached/);
  assert.match(safeErrorMessage(new CredentialUnavailableError("Azure CLI could not be found.")), /No Azure credential is available.*az login/);
  assert.match(
    safeErrorMessage(new AggregateAuthenticationError([new CredentialUnavailableError("x")], "ChainedTokenCredential authentication failed.")),
    /No Azure credential is available/,
  );
  const signIn = safeErrorMessage(new AuthenticationError(400, { error: "invalid_grant", error_description: "AADSTS50020: tenant 11111111-1111-1111-1111-111111111111" }));
  assert.match(signIn, /^Azure sign-in failed/);
  assert.doesNotMatch(signIn, /11111111/);
  assert.match(safeErrorMessage(new DOMException("The operation timed out.", "TimeoutError")), /timed out/);
});

test("never passes an Azure SDK message through the validation-message allowlist", () => {
  const error = restError(403, "KQL query denied for tenant 11111111-1111-1111-1111-111111111111", { code: "InsufficientAccessError" });
  assert.doesNotMatch(safeErrorMessage(error), /11111111/);
});
