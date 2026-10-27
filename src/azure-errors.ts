/**
 * Turns Azure failures into messages an MCP client can act on without leaking upstream
 * details. A rejected request (HTTP 400) describes the caller's own query or inputs, so
 * the service's most specific message is passed through. Every other failure gets only
 * the status, the Azure error code and a fix hint: those upstream messages can carry
 * tenant IDs, object IDs and scopes.
 */

const maxDetailLength = 1_000;
const errorCodePattern = /^[A-Za-z][\w.-]{0,79}$/;

const statusHints: Record<number, string> = {
  401: "Sign in to the tenant that owns the resource (az login --tenant <tenant-id>) and make sure AZURE_TENANT_ID matches it.",
  403: "The signed-in identity lacks access: Azure Resource Graph and workspace discovery need Reader on the subscription, and workspace queries need Log Analytics Reader on the workspace.",
  404: "Check the subscription ID, workspace ID or resource ID, and table name (case-sensitive); list_workspaces and search_tables return valid values.",
  429: "Azure is throttling requests. Wait a minute and retry.",
};

export const genericFailure = "Request failed. Verify the inputs, Azure authentication, RBAC, and service availability.";

interface ErrorNode {
  error?: unknown;
  code?: unknown;
  message?: unknown;
  innererror?: unknown;
  details?: unknown;
}

const asNode = (value: unknown): ErrorNode | undefined =>
  value !== null && typeof value === "object" ? (value as ErrorNode) : undefined;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * Most specific code and message in an Azure error body. Log Analytics nests the real
 * cause in `innererror` (for example SEM0100 under SemanticError); ARM and Resource Graph
 * put it in `details[]` under a generic top-level message.
 */
export function errorDetail(body: unknown): { code?: string; message?: string } {
  const root = asNode(body);
  let node = root?.error === undefined ? root : asNode(root.error);
  while (node && text(asNode(node.innererror)?.message)) {
    node = asNode(node.innererror);
  }
  if (!node) {
    return {};
  }

  const details = (Array.isArray(node.details) ? node.details : []).map(asNode).filter((detail) => text(detail?.message));
  const source = details.at(-1) ?? node;
  const message = details.length ? details.map((detail) => text(detail?.message)).join(" ") : text(node.message);
  const code = text(source.code);
  return {
    ...(code && errorCodePattern.test(code) ? { code } : {}),
    ...(message ? { message } : {}),
  };
}

/** Message for a failed Azure HTTP call. `prefix` names the request, e.g. "Azure request failed". */
export function httpFailureMessage(prefix: string, status: number, body: unknown, fallback: { code?: string; message?: string } = {}) {
  const parsed = errorDetail(body);
  const code = parsed.code ?? (fallback.code && errorCodePattern.test(fallback.code) ? fallback.code : undefined);
  const label = `${prefix} with HTTP ${status}${code ? ` (${code})` : ""}`;

  const message = parsed.message ?? text(fallback.message);
  if (status === 400 && message) {
    return `${label}: ${message.length > maxDetailLength ? `${message.slice(0, maxDetailLength)}...[truncated]` : message}`;
  }
  const hint = statusHints[status] ?? (status >= 500 ? "Azure returned a server error. Retry shortly." : undefined);
  return hint ? `${label}. ${hint}` : `${label}.`;
}

interface RestErrorLike extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
  response?: { parsedBody?: unknown };
}

// Duck-typed: several copies of @azure/core-rest-pipeline can be installed, so instanceof is unreliable.
function isRestError(error: Error): error is RestErrorLike {
  return error.name === "RestError";
}

/** Message for an error raised by the Azure SDK or credential chain, or undefined if it is not one. */
export function azureErrorMessage(error: Error): string | undefined {
  if (isRestError(error)) {
    if (typeof error.statusCode !== "number") {
      return "Azure could not be reached. Check network access to Microsoft Entra ID, Azure Resource Manager and the Log Analytics query endpoint.";
    }
    // Only a deserialized error body sets `code`; otherwise the message is the raw response text.
    const fallback = error.code ? { code: error.code, message: error.message } : {};
    return httpFailureMessage("Azure request failed", error.statusCode, error.details ?? error.response?.parsedBody, fallback);
  }

  switch (error.name) {
    // DefaultAzureCredential raises AggregateAuthenticationError when every credential in the chain is unavailable.
    case "CredentialUnavailableError":
    case "AggregateAuthenticationError":
      return "No Azure credential is available. Sign in with az login --tenant <tenant-id>, or configure a managed identity or service principal.";
    case "AuthenticationError":
      return "Azure sign-in failed. Run az login --tenant <tenant-id> again and make sure AZURE_TENANT_ID matches the tenant you signed in to.";
    case "TimeoutError":
      return "The Azure request timed out. Narrow the query or timespan and retry.";
    default:
      return undefined;
  }
}
