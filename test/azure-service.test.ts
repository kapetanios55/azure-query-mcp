import assert from "node:assert/strict";
import test from "node:test";

import type { TokenCredential } from "@azure/core-auth";
import { createHttpHeaders, type HttpClient, type PipelineRequest } from "@azure/core-rest-pipeline";

import { LogAnalyticsService } from "../src/azure-service.js";
import { resolveCloud } from "../src/cloud.js";

// These tests run the real Azure SDK clients against a fake HTTP transport, so they
// check the URLs, token scopes and request bodies the server actually sends.

const workspaceGuid = "4f2a8c1e-7b3d-4e5f-9a6b-1c2d3e4f5a6b";
const resourceId = "/subscriptions/00000000-0000-4000-8000-000000000000/resourceGroups/rg-soc/providers/Microsoft.OperationalInsights/workspaces/law-soc";

function fakeCredential() {
  const scopes: string[] = [];
  const credential: TokenCredential = {
    async getToken(scope) {
      scopes.push(...[scope].flat());
      return { token: "test-token", expiresOnTimestamp: Date.now() + 3_600_000 };
    },
  };
  return { credential, scopes };
}

/** Like the real transport: settles only when the request's signal aborts, even if it already has. */
function untilAborted(request: PipelineRequest): Promise<never> {
  const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
  return new Promise((_resolve, reject) => {
    if (request.abortSignal?.aborted) {
      reject(abortError());
      return;
    }
    request.abortSignal?.addEventListener("abort", () => reject(abortError()));
  });
}

const queryResponse = { tables: [{ name: "PrimaryResult", columns: [{ name: "Count", type: "long" }], rows: [[3]] }] };

function fakeAzure(respond?: (request: PipelineRequest) => Promise<unknown>) {
  const requests: Array<{ method: string; url: string; body: string }> = [];
  const httpClient: HttpClient = {
    async sendRequest(request) {
      requests.push({ method: request.method, url: request.url, body: typeof request.body === "string" ? request.body : "" });
      const body = respond
        ? await respond(request)
        : request.url.includes("/query") ? queryResponse : { id: resourceId, name: "law-soc", properties: { customerId: workspaceGuid } };
      return { request, status: 200, headers: createHttpHeaders({ "content-type": "application/json" }), bodyAsText: JSON.stringify(body) };
    },
  };
  return { httpClient, requests };
}

test("uses the US Government endpoints and token scopes, resolving a resource ID once", async () => {
  const { credential, scopes } = fakeCredential();
  const { httpClient, requests } = fakeAzure();
  const service = new LogAnalyticsService(credential, { cloud: resolveCloud("AzureUSGovernment"), httpClient });

  const first = await service.queryWorkspace(resourceId, "Heartbeat | count", "P1D");
  await service.queryWorkspace(resourceId, "Heartbeat | count", "P1D");

  assert.equal(first.tables[0]?.rows[0]?.[0], 3);
  const lookups = requests.filter((request) => request.method === "GET");
  assert.equal(lookups.length, 1, "the resource ID is resolved once and then cached");
  assert.match(lookups[0]?.url ?? "", /^https:\/\/management\.usgovcloudapi\.net\/subscriptions\/00000000-0000-4000-8000-000000000000\/resourceGroups\/rg-soc\/providers\/Microsoft\.OperationalInsights\/workspaces\/law-soc\?/);
  const queries = requests.filter((request) => request.method === "POST");
  assert.equal(queries.length, 2);
  assert.equal(queries[0]?.url, `https://api.loganalytics.us/v1/workspaces/${workspaceGuid}/query`);
  assert.ok(scopes.includes("https://management.usgovcloudapi.net/.default"));
  assert.ok(scopes.includes("https://api.loganalytics.us/.default"));
  assert.ok(!scopes.some((scope) => scope.includes("azure.com") || scope.includes("loganalytics.io")), "no public-cloud scope is requested");
});

test("queries a workspace GUID directly and sends an absolute interval", async () => {
  const { credential } = fakeCredential();
  const { httpClient, requests } = fakeAzure();
  const service = new LogAnalyticsService(credential, { cloud: resolveCloud("AzurePublicCloud"), httpClient });

  await service.queryWorkspace(workspaceGuid, "SigninLogs | count", "2026-10-01T00:00:00Z/2026-10-02T00:00:00Z");

  assert.deepEqual(requests.map((request) => request.method), ["POST"], "a GUID needs no lookup");
  assert.equal(requests[0]?.url, `https://api.loganalytics.io/v1/workspaces/${workspaceGuid}/query`);
  assert.equal(JSON.parse(requests[0]?.body ?? "{}").timespan, "2026-10-01T00:00:00.000Z/2026-10-02T00:00:00.000Z");
});

test("cancelling the tool call aborts the in-flight Log Analytics request", async () => {
  const { credential } = fakeCredential();
  let seenSignal: PipelineRequest["abortSignal"];
  const { httpClient } = fakeAzure((request) => {
    seenSignal = request.abortSignal;
    return untilAborted(request);
  });
  const service = new LogAnalyticsService(credential, { cloud: resolveCloud("AzurePublicCloud"), httpClient });
  const controller = new AbortController();

  const pending = service.queryWorkspace(workspaceGuid, "SigninLogs | count", "P1D", controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(seenSignal?.aborted, "the request carried the tool call's signal");
});

test("concurrent queries keep their own cancellation", async () => {
  const { credential } = fakeCredential();
  const { httpClient } = fakeAzure((request) =>
    String(request.body).includes("slow") ? untilAborted(request) : Promise.resolve(queryResponse),
  );
  const service = new LogAnalyticsService(credential, { cloud: resolveCloud("AzurePublicCloud"), httpClient });
  const slow = new AbortController();

  const cancelled = service.queryWorkspace(workspaceGuid, "print slow = 1 | take 1", "P1D", slow.signal);
  const other = service.queryWorkspace(workspaceGuid, "SigninLogs | count", "P1D", new AbortController().signal);
  slow.abort();

  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal((await other).tables[0]?.rows[0]?.[0], 3);
});

test("rejects a bad workspace or timespan before calling Azure", async () => {
  const { credential } = fakeCredential();
  const { httpClient, requests } = fakeAzure();
  const service = new LogAnalyticsService(credential, { cloud: resolveCloud("AzurePublicCloud"), httpClient });

  await assert.rejects(service.queryWorkspace("law-soc", "Heartbeat | count", "P1D"), /^Error: workspaceId must be/);
  await assert.rejects(service.queryWorkspace(workspaceGuid, "Heartbeat | count", "2026-10-01T00:00:00/P1D"), /^Error: Timespan '2026-10-01T00:00:00\/P1D' is not valid/);
  assert.equal(requests.length, 0);
});
