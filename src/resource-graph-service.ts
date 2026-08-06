import type { AccessToken, TokenCredential } from "@azure/core-auth";

import { createDefaultCredential } from "./azure-service.js";
import { validateResourceGraphQuery } from "./resource-graph-policy.js";

const resourceGraphEndpoint = "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01";
const armScope = "https://management.azure.com/.default";
const requestTimeoutMs = 30_000;
const maxResponseBytes = 5 * 1024 * 1024;

type Fetch = typeof globalThis.fetch;

interface ResourceGraphResponse {
  count?: number;
  data?: unknown;
  facets?: unknown[];
  resultTruncated?: string;
  totalRecords?: number;
  $skipToken?: string;
}

export class ResourceGraphService {
  constructor(
    private readonly credential: TokenCredential = createDefaultCredential(),
    private readonly fetch: Fetch = globalThis.fetch,
  ) {}

  async queryResources(
    subscriptionIds: string[],
    query: string,
    maxResults = 100,
    skipToken?: string,
  ) {
    validateResourceGraphQuery(query);
    const token = await this.credential.getToken(armScope);

    if (!token) {
      throw new Error("Azure authentication did not return an access token.");
    }

    const response = await this.fetch(resourceGraphEndpoint, {
      method: "POST",
      headers: {
        Authorization: authorizationHeader(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subscriptions: subscriptionIds,
        query,
        options: {
          $top: maxResults,
          resultFormat: "objectArray",
          ...(skipToken ? { $skipToken: skipToken } : {}),
        },
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Azure Resource Graph request failed with HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      throw new Error("Azure Resource Graph response exceeds the 5 MiB safety limit.");
    }

    const responseBody = await response.text();
    if (Buffer.byteLength(responseBody, "utf8") > maxResponseBytes) {
      throw new Error("Azure Resource Graph response exceeds the 5 MiB safety limit.");
    }

    const result = JSON.parse(responseBody) as ResourceGraphResponse;
    return {
      count: result.count ?? 0,
      totalRecords: result.totalRecords ?? 0,
      resultTruncated: result.resultTruncated === "true",
      data: result.data ?? [],
      facets: result.facets ?? [],
      ...(result.$skipToken ? { skipToken: result.$skipToken } : {}),
    };
  }
}

function authorizationHeader(token: AccessToken) {
  return `Bearer ${token.token}`;
}