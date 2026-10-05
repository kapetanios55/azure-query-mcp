import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LogsQueryResultStatus } from "@azure/monitor-query-logs";

import type { WorkspaceQueryRunner } from "../src/azure-service.js";
import { builtInHuntingQueries, HuntingLibrary } from "../src/hunting-library.js";
import { validateQuery } from "../src/query-policy.js";
import type { ShapedTable } from "../src/result-shaper.js";
import { extractPivotEntities, SocService, tableToRows } from "../src/soc-service.js";

const workspaceId = "4f2a8c1e-7b3d-4e5f-9a6b-1c2d3e4f5a6b";

function table(columns: string[], rows: unknown[][]): ShapedTable {
  return {
    name: "PrimaryResult",
    columns: columns.map((name) => ({ name, type: "string" })),
    rows,
    returnedRows: rows.length,
    truncatedRows: 0,
  };
}

/** Fake runner that answers by matching a substring of the generated KQL. */
function fakeRunner(responses: Array<[RegExp, ShapedTable]>) {
  const calls: Array<{ query: string; timespan: string }> = [];
  const runner: WorkspaceQueryRunner = {
    async runQuery(_workspaceId, query, timespan) {
      calls.push({ query, timespan });
      const match = responses.find(([pattern]) => pattern.test(query));
      return { status: LogsQueryResultStatus.Success, tables: [match?.[1] ?? table([], [])] };
    },
  };
  return { runner, calls };
}

test("tableToRows maps columns onto row objects", () => {
  assert.deepEqual(tableToRows(table(["a", "b"], [[1, "x"]])), [{ a: 1, b: "x" }]);
  assert.deepEqual(tableToRows(undefined), []);
});

test("extractPivotEntities picks the best identifier from real-world entity shapes", () => {
  const entities = JSON.stringify([
    { Type: "account", Name: "alice", UPNSuffix: "contoso.com", UserPrincipalName: "alice@contoso.com" },
    { Type: "account", Name: "bob", UPNSuffix: "contoso.com" },
    { Type: "account", Name: "svc_backup", NTDomain: "CONTOSO", AccountName: "svc_backup" },
    { Type: "account", Name: "Carol Jones", AccountName: "Carol Jones", IsDomainJoined: false },
    { Type: "account", Sid: "S-1-5-21-1-2-3-500" },
    { Type: "account", AadUserId: "11111111-2222-3333-4444-555555555555" },
    { Type: "ip", Address: "203.0.113.7" },
    { Type: "ip", Address: "not-an-ip" },
    { Type: "host", HostName: "web-01", DnsDomain: "corp.contoso.com" },
    { Type: "file", Name: "evil.exe" },
  ]);
  const duplicate = JSON.stringify([{ Type: "account", UserPrincipalName: "ALICE@contoso.com" }]);
  const { pivots, unresolved } = extractPivotEntities([{ Entities: entities }, { Entities: duplicate }, { Entities: "not json" }]);

  assert.deepEqual(pivots, [
    { type: "account", value: "ALICE@contoso.com" },
    { type: "account", value: "bob@contoso.com" },
    { type: "account", value: "svc_backup" },
    { type: "ip", value: "203.0.113.7" },
    { type: "host", value: "web-01.corp.contoso.com" },
  ]);
  assert.deepEqual(unresolved, [
    { type: "account", reason: "only a display name is recorded, not a UPN or account name", label: "Carol Jones" },
    { type: "account", reason: "only a SID is recorded" },
    { type: "account", reason: "only an Entra object ID is recorded" },
    { type: "ip", reason: "no valid address or hostname recorded" },
  ]);
});

test("getIncident combines detail, alerts and pivot entities", async () => {
  const { runner } = fakeRunner([
    [/let alertIds/, table(["AlertName", "Entities"], [["Suspicious sign-in", JSON.stringify([{ Type: "ip", Address: "198.51.100.4" }])]])],
    [/IncidentNumber == 12/, table(["IncidentNumber", "Title", "Severity"], [[12, "Possible credential theft", "High"]])],
  ]);
  const result = await new SocService(runner, new HuntingLibrary("")).getIncident(workspaceId, 12, "P30D");

  assert.equal(result.incident.Title, "Possible credential theft");
  assert.deepEqual(result.alerts, [{ AlertName: "Suspicious sign-in" }]);
  assert.deepEqual(result.pivotEntities, [{ type: "ip", value: "198.51.100.4" }]);
  assert.deepEqual(result.unresolvedEntities, []);
});

test("getIncident reports a missing incident clearly", async () => {
  const { runner } = fakeRunner([]);
  await assert.rejects(
    new SocService(runner, new HuntingLibrary("")).getIncident(workspaceId, 999, "P30D"),
    /found no incident 999/,
  );
});

test("entityTimeline returns complete per-source totals alongside capped events", async () => {
  const { runner, calls } = fakeRunner([
    [/summarize Events = count\(\)/, table(["Source", "Events"], [["SigninLogs", 340], ["SecurityAlert", 2]])],
    [/take 2$/, table(["TimeGenerated", "Source", "Activity"], [["2026-10-01T10:00:00Z", "SigninLogs", "Sign-in to Azure Portal succeeded"], ["2026-10-01T09:59:00Z", "SecurityAlert", "Impossible travel"]])],
  ]);
  const result = await new SocService(runner, new HuntingLibrary("")).entityTimeline(workspaceId, "account", "alice@contoso.com", "P3D", 2);

  assert.equal(result.totalEvents, 342);
  assert.equal(result.returnedEvents, 2);
  assert.ok(calls.every((call) => call.timespan === "P3D"));
});

test("checkIngestionHealth summarises stale, dropped and delayed tables", async () => {
  const { runner, calls } = fakeRunner([
    [/^Usage/, table(["DataType", "Status"], [["SigninLogs", "Healthy"], ["CommonSecurityLog", "Stale"], ["Syslog", "VolumeDrop"], ["AzureActivity", "VolumeSpike"]])],
    [/union withsource=AzureQueryMcpSourceTable/, table(["TableName", "P95LatencySec"], [["SecurityEvent", 1800], ["SigninLogs", 120]])],
  ]);
  const result = await new SocService(runner, new HuntingLibrary("")).checkIngestionHealth(workspaceId, "P7D", 24);

  assert.deepEqual(result.summary, {
    tables: 4,
    stale: ["CommonSecurityLog"],
    volumeDrops: ["Syslog"],
    volumeSpikes: ["AzureActivity"],
    delayedOver15Min: ["SecurityEvent"],
  });
  assert.equal(calls.find((call) => /union withsource/.test(call.query))?.timespan, "PT1H");
});

test("runHuntingQuery runs a built-in hunt and rejects unknown IDs", async () => {
  const { runner, calls } = fakeRunner([[/ResultType in \("50126"/, table(["IPAddress", "FailedAccounts"], [["198.51.100.4", 25]])]]);
  const service = new SocService(runner, new HuntingLibrary(""));

  const result = await service.runHuntingQuery(workspaceId, "password-spray", "P1D");
  assert.equal(result.resultCount, 1);
  assert.equal(result.hunt.id, "password-spray");
  assert.equal(calls[0]?.timespan, "P1D");

  await assert.rejects(service.runHuntingQuery(workspaceId, "nope", "P1D"), /Hunting query 'nope' was not found/);
});

test("HuntingLibrary loads SentinelCBContent-format files and rejects unsafe ones", () => {
  const directory = mkdtempSync(join(tmpdir(), "hunts-"));
  try {
    writeFileSync(join(directory, "good.json"), JSON.stringify({
      id: "custom-hunt", name: "Custom hunt", tactics: ["Execution"], techniques: ["T1059"],
      query: "let lookback = 30d;\nSecurityEvent | where TimeGenerated >= ago(lookback) | where CommandLine has \"delete\"",
    }));
    writeFileSync(join(directory, "unsafe.json"), JSON.stringify({ id: "bad", name: "Bad", query: ".drop table SecurityEvent" }));
    writeFileSync(join(directory, "duplicate.json"), JSON.stringify({ id: "password-spray", name: "Dup", query: "SigninLogs | take 1" }));
    writeFileSync(join(directory, "broken.json"), "{ not json");

    const library = new HuntingLibrary(directory);
    const ids = library.list().map((query) => query.id);

    assert.ok(ids.includes("custom-hunt"));
    assert.ok(!ids.includes("bad"));
    assert.equal(library.get("password-spray").source, "built-in");
    assert.equal(library.loadErrors.length, 3);
    assert.ok(library.loadErrors.some((error) => error.startsWith("unsafe.json")));
    assert.ok(library.loadErrors.some((error) => error.includes("duplicate id")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every built-in hunting query passes the read-only policy", () => {
  assert.ok(builtInHuntingQueries.length >= 5);
  for (const hunt of builtInHuntingQueries) {
    assert.doesNotThrow(() => validateQuery(hunt.query, HuntingLibrary.policy), hunt.id);
    assert.ok(hunt.techniques.every((technique) => /^T\d{4}$/.test(technique)), hunt.id);
  }
});
