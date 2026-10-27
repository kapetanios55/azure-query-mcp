import assert from "node:assert/strict";
import test from "node:test";

import { resolveCloud } from "../src/cloud.js";

test("defaults to the public cloud", () => {
  assert.equal(resolveCloud(undefined).name, "AzurePublicCloud");
  assert.equal(resolveCloud("").name, "AzurePublicCloud");
});

test("accepts SDK and az CLI cloud names in any case", () => {
  assert.equal(resolveCloud("AzureCloud").name, "AzurePublicCloud");
  assert.equal(resolveCloud("azureusgovernment").name, "AzureUSGovernment");
  assert.equal(resolveCloud(" AzureChinaCloud ").name, "AzureChinaCloud");
});

test("maps each cloud to its own endpoints", () => {
  assert.deepEqual(
    { ...resolveCloud("AzureUSGovernment") },
    {
      name: "AzureUSGovernment",
      authorityHost: "https://login.microsoftonline.us",
      resourceManager: "https://management.usgovcloudapi.net",
      logAnalytics: "https://api.loganalytics.us",
    },
  );
  assert.equal(resolveCloud("AzureChinaCloud").logAnalytics, "https://api.loganalytics.azure.cn");
  assert.equal(resolveCloud("AzureChinaCloud").authorityHost, "https://login.chinacloudapi.cn");
});

test("refuses an unknown cloud instead of falling back to the public cloud", () => {
  assert.throws(() => resolveCloud("AzureGermanCloud"), /AZURE_QUERY_MCP_CLOUD 'AzureGermanCloud' is not a supported cloud/);
});
