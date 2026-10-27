import assert from "node:assert/strict";
import test from "node:test";

import type { TokenCredential } from "@azure/core-auth";

import { ResourceGraphService } from "../src/resource-graph-service.js";

const credential: TokenCredential = {
  async getToken() {
    return { token: "test-token", expiresOnTimestamp: Date.now() + 60_000 };
  },
};

test("sends a scoped and bounded Resource Graph REST request", async () => {
  let request: { input: string | URL | Request; init?: RequestInit } | undefined;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    request = { input, init };
    return Response.json({ count: 1, totalRecords: 1, resultTruncated: "false", data: [{ name: "vm" }] });
  };
  const service = new ResourceGraphService(credential, fetch);

  const result = await service.queryResources(
    ["00000000-0000-4000-8000-000000000000"],
    "Resources | project name | limit 1",
    25,
  );

  assert.equal(String(request?.input), "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    subscriptions: ["00000000-0000-4000-8000-000000000000"],
    query: "Resources | project name | limit 1",
    options: { $top: 25, resultFormat: "objectArray" },
  });
  assert.deepEqual(result.data, [{ name: "vm" }]);
});

test("does not expose Azure error response bodies for authorization failures", async () => {
  const fetch = async () => Response.json({
    error: { code: "AuthorizationFailed", message: "The client 'sensitive-object-id' with tenant 11111111-1111-1111-1111-111111111111 has no access." },
  }, { status: 403 });
  const service = new ResourceGraphService(credential, fetch);

  await assert.rejects(
    service.queryResources(["00000000-0000-4000-8000-000000000000"], "Resources | limit 1"),
    (error: Error) => {
      assert.match(error.message, /^Azure Resource Graph request failed with HTTP 403 \(AuthorizationFailed\)\. .*Reader on the subscription/);
      assert.doesNotMatch(error.message, /sensitive-object-id|11111111/);
      return true;
    },
  );
});

test("ignores non-JSON error bodies", async () => {
  const fetch = async () => new Response("sensitive upstream details", { status: 400 });
  const service = new ResourceGraphService(credential, fetch);

  await assert.rejects(
    service.queryResources(["00000000-0000-4000-8000-000000000000"], "Resources | limit 1"),
    /^Error: Azure Resource Graph request failed with HTTP 400\.$/,
  );
});

test("explains why ARG rejected a query", async () => {
  const fetch = async () => Response.json({
    error: {
      code: "BadRequest",
      message: "Please provide below info when asking for support: timestamp = 2026-10-27T10:00:00Z, correlationId = abc.",
      details: [
        { code: "InvalidQuery", message: "Query is invalid. Please refer to the documentation for the Azure Resource Graph service and fix the error before retrying." },
        { code: "UnknownFunction", message: "Unknown function: 'tolowr'." },
      ],
    },
  }, { status: 400 });
  const service = new ResourceGraphService(credential, fetch);

  await assert.rejects(
    service.queryResources(["00000000-0000-4000-8000-000000000000"], "Resources | extend n = tolowr(name) | limit 1"),
    /^Error: Azure Resource Graph request failed with HTTP 400 \(UnknownFunction\): Query is invalid\..* Unknown function: 'tolowr'\.$/,
  );
});

test("rejects oversized responses before parsing", async () => {
  const fetch = async () => new Response("{}", {
    headers: { "content-length": String(6 * 1024 * 1024) },
  });
  const service = new ResourceGraphService(credential, fetch);

  await assert.rejects(
    service.queryResources(
      ["00000000-0000-4000-8000-000000000000"],
      "Resources | limit 1",
    ),
    /5 MiB safety limit/,
  );
});