import { stripLiteralsAndComments } from "./kql-lexer.js";

const managementCommands = /^\s*\./m;
const setStatements = /(?:^|;)\s*set\s+\w/i;
const dangerousOperators = /\b(?:externaldata|external_data|ingest|append|drop|delete|purge)\b/i;
const evaluatePlugins = /\bevaluate\s+(?:hint\.\w+\s*=\s*\w+\s+)*(\w+)/gi;
const resultLimit = /\|\s*(?:take|limit|top)\s+\d+\b|\|\s*(?:summarize|count)\b/i;

/**
 * `evaluate` plugins that only reshape or analyse rows the query already returned.
 * Plugins that reach outside the workspace (http_request, sql_request, python, r, ...)
 * stay blocked.
 */
export const allowedEvaluatePlugins = new Set([
  "autocluster",
  "bag_unpack",
  "basket",
  "diffpatterns",
  "ipv4_lookup",
  "ipv6_lookup",
  "narrow",
  "pivot",
  "preview",
]);

export interface QueryPolicyOptions {
  maxLength: number;
  requireResultLimit: boolean;
}

const defaultOptions: QueryPolicyOptions = {
  maxLength: 5_000,
  requireResultLimit: true,
};

export function validateQuery(
  query: string,
  options: QueryPolicyOptions = defaultOptions,
): void {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error("KQL query must not be empty.");
  }

  if (trimmedQuery.length > options.maxLength) {
    throw new Error(`KQL query exceeds the ${options.maxLength} character limit.`);
  }

  // Keywords inside string literals or comments are data, not operators.
  const code = stripLiteralsAndComments(trimmedQuery);

  if (managementCommands.test(code) || setStatements.test(code) || dangerousOperators.test(code)) {
    throw new Error("Only read-only KQL queries are supported.");
  }

  for (const [, plugin = ""] of code.matchAll(evaluatePlugins)) {
    if (!allowedEvaluatePlugins.has(plugin.toLowerCase())) {
      throw new Error(
        `The evaluate plugin '${plugin}' is not allowed. Allowed plugins: ${[...allowedEvaluatePlugins].join(", ")}.`,
      );
    }
  }

  if (options.requireResultLimit && !resultLimit.test(code)) {
    throw new Error("KQL query must include take, limit, top, summarize, or count.");
  }
}
