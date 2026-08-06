const managementCommands = /^\s*\./m;
const disallowedOperators = /\b(?:evaluate|externaldata|external_data|ingest|set|append|drop|delete|purge)\b/i;
const allowedTables = /^(?:resources|resourcecontainers|advisorresources|authorizationresources|chaosresources|desktopvirtualizationresources|extendedlocationresources|guestconfigurationresources|healthresources|iotsecurityresources|kubernetesconfigurationresources|maintenanceresources|networkresources|patchassessmentresources|patchinstallationresources|policyresources|recoveryservicesresources|securityresources|servicehealthresources|servicehealthresources|spotresources)\b/i;

export function validateResourceGraphQuery(query: string): void {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error("Azure Resource Graph query must not be empty.");
  }

  if (trimmedQuery.length > 5_000) {
    throw new Error("Azure Resource Graph query exceeds the 5000 character limit.");
  }

  if (!allowedTables.test(trimmedQuery)) {
    throw new Error("Azure Resource Graph query must start with a supported ARG table.");
  }

  if (managementCommands.test(trimmedQuery) || disallowedOperators.test(trimmedQuery)) {
    throw new Error("Only read-only Azure Resource Graph queries are supported.");
  }
}