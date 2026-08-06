import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkspaceResourceId } from "../src/workspace-id.js";

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