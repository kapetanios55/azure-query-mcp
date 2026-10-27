import type { AccessToken, TokenCredential } from "@azure/core-auth";

import { httpFailureMessage } from "./azure-errors.js";
import { defaultCloud, defaultCredential } from "./azure-service.js";
import type { AzureCloud } from "./cloud.js";
import { validateResourceGraphQuery } from "./resource-graph-policy.js";

const requestTimeoutMs = 30_000;
const maxResponseBytes = 5 * 1024 * 1024;
const maxErrorBodyCharacters = 64 * 1024;

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
  readonly #endpoint: string;
  readonly #scope: string;

  constructor(
    private readonly credential: TokenCredential = defaultCredential(),
    private readonly fetch: Fetch = globalThis.fetch,
    cloud: AzureCloud = defaultCloud(),
  ) {
    this.#endpoint = `${cloud.resourceManager}/providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01`;
    this.#scope = `${cloud.resourceManager}/.default`;
  }

  async queryResources(
    subscriptionIds: string[],
    query: string,
    maxResults = 100,
    skipToken?: string,
    signal?: AbortSignal,
  ) {
    validateResourceGraphQuery(query);
    const token = await this.credential.getToken(this.#scope, signal ? { abortSignal: signal } : {});

    if (!token) {
      throw new Error("Azure authentication did not return an access token.");
    }

    const response = await this.fetch(this.#endpoint, {
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
      signal: signal ? AbortSignal.any([AbortSignal.timeout(requestTimeoutMs), signal]) : AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      // httpFailureMessage passes through only the query error detail of a 400, never other bodies.
      throw new Error(httpFailureMessage("Azure Resource Graph request failed", response.status, await errorBody(response)));
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

async function errorBody(response: Response): Promise<unknown> {
  try {
    const body = await response.text();
    return body.length <= maxErrorBodyCharacters ? JSON.parse(body) : undefined;
  } catch {
    return undefined;
  }
}

function authorizationHeader(token: AccessToken) {
  return `Bearer ${token.token}`;
}