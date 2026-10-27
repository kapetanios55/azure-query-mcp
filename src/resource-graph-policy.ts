import { stripLiteralsAndComments } from "./kql-lexer.js";

const managementCommands = /^\s*\./m;
const disallowedOperators = /\b(?:evaluate|externaldata|external_data|ingest|set|append|drop|delete|purge)\b/i;
// Every ARG table is named *resources, *resourcechanges, resourcecontainers or
// resourcecontainerchanges (ResourceChanges, AppServiceResources, ...). Matching the
// naming scheme keeps new tables working while still catching Log Analytics tables
// such as Heartbeat sent to the wrong tool. ARG itself rejects unknown tables.
const allowedTables = /^[a-z]*(?:resources|resourcechanges|resourcecontainers|resourcecontainerchanges)\b/i;

export function validateResourceGraphQuery(query: string): void {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error("Azure Resource Graph query must not be empty.");
  }

  if (trimmedQuery.length > 5_000) {
    throw new Error("Azure Resource Graph query exceeds the 5000 character limit.");
  }

  // Keywords inside string literals or comments are data, not operators.
  const code = stripLiteralsAndComments(trimmedQuery).trim();

  if (!allowedTables.test(code)) {
    throw new Error("Azure Resource Graph query must start with a supported ARG table such as Resources, ResourceContainers or ResourceChanges. Query Log Analytics tables with query_workspace.");
  }

  if (managementCommands.test(code) || disallowedOperators.test(code)) {
    throw new Error("Only read-only Azure Resource Graph queries are supported.");
  }
}
