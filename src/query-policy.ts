const managementCommands = /^\s*\./m;
const dangerousOperators = /\b(?:evaluate|externaldata|ingest|set|append|drop|delete|purge)\b/i;
const resultLimit = /\|\s*(?:take|limit)\s+\d+\b|\|\s*(?:summarize|count)\b/i;

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

  if (managementCommands.test(trimmedQuery) || dangerousOperators.test(trimmedQuery)) {
    throw new Error("Only read-only KQL queries are supported.");
  }

  if (options.requireResultLimit && !resultLimit.test(trimmedQuery)) {
    throw new Error("KQL query must include take, limit, summarize, or count.");
  }
}