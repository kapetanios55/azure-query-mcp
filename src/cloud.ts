import { AzureAuthorityHosts } from "@azure/identity";

/** Endpoints for one Azure cloud. Every request and token scope is derived from these. */
export interface AzureCloud {
  name: "AzurePublicCloud" | "AzureUSGovernment" | "AzureChinaCloud";
  authorityHost: string;
  resourceManager: string;
  logAnalytics: string;
}

const clouds: Record<AzureCloud["name"], AzureCloud> = {
  AzurePublicCloud: {
    name: "AzurePublicCloud",
    authorityHost: AzureAuthorityHosts.AzurePublicCloud,
    resourceManager: "https://management.azure.com",
    logAnalytics: "https://api.loganalytics.io",
  },
  AzureUSGovernment: {
    name: "AzureUSGovernment",
    authorityHost: AzureAuthorityHosts.AzureGovernment,
    resourceManager: "https://management.usgovcloudapi.net",
    logAnalytics: "https://api.loganalytics.us",
  },
  AzureChinaCloud: {
    name: "AzureChinaCloud",
    authorityHost: AzureAuthorityHosts.AzureChina,
    resourceManager: "https://management.chinacloudapi.cn",
    logAnalytics: "https://api.loganalytics.azure.cn",
  },
};

// Accepts the names az CLI uses (`az cloud list`) as well as the SDK names.
const aliases: Record<string, AzureCloud["name"]> = {
  "": "AzurePublicCloud",
  azurecloud: "AzurePublicCloud",
  azurepubliccloud: "AzurePublicCloud",
  public: "AzurePublicCloud",
  azureusgovernment: "AzureUSGovernment",
  usgovernment: "AzureUSGovernment",
  azurechinacloud: "AzureChinaCloud",
  china: "AzureChinaCloud",
};

/**
 * Resolves AZURE_QUERY_MCP_CLOUD. An unknown name is an error rather than a fallback to
 * the public cloud, so a typo never sends tokens or queries to the wrong cloud.
 */
export function resolveCloud(value = process.env.AZURE_QUERY_MCP_CLOUD): AzureCloud {
  const name = aliases[(value ?? "").trim().toLowerCase()];
  if (!name) {
    throw new Error(
      `AZURE_QUERY_MCP_CLOUD '${value}' is not a supported cloud. Use AzurePublicCloud, AzureUSGovernment or AzureChinaCloud.`,
    );
  }
  return clouds[name];
}
