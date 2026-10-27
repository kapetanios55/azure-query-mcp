import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkspaceRef, parseWorkspaceResourceId } from "../src/workspace-id.js";

test("parses a Log Analytics workspace ARM ID", () => {
  assert.deepEqual(
    parseWorkspaceResourceId(
      "/subscriptions/sub-id/resourceGroups/security-rg/providers/Microsoft.OperationalInsights/workspaces/soc-law",
    ),
    {
      subscriptionId: "sub-id",
      resourceGroupName: "security-rg",
      workspaceName: "soc-law",
    },
  );
});

test("rejects IDs for other Azure resource types", () => {
  assert.throws(
    () => parseWorkspaceResourceId("/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/logs"),
    /full Log Analytics workspace ARM resource ID/,
  );
});
test("accepts a workspace GUID or a full resource ID as a workspace reference", () => {
  assert.deepEqual(parseWorkspaceRef(" 4f2a8c1e-7b3d-4e5f-9a6b-1c2d3e4f5a6b "), { kind: "id", workspaceId: "4f2a8c1e-7b3d-4e5f-9a6b-1c2d3e4f5a6b" });
  const resourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/law";
  assert.deepEqual(parseWorkspaceRef(resourceId), {
    kind: "resource",
    resourceId,
    subscriptionId: "sub",
    resourceGroupName: "rg",
    workspaceName: "law",
  });
  assert.throws(() => parseWorkspaceRef("law"), /^Error: workspaceId must be a Log Analytics workspace ID \(GUID\) or/);
});

test("explains that metadata tools need the resource ID when given a GUID", () => {
  assert.throws(() => parseWorkspaceResourceId("4f2a8c1e-7b3d-4e5f-9a6b-1c2d3e4f5a6b"), /not its workspace ID \(GUID\); list_workspaces returns it as resourceId/);
});
