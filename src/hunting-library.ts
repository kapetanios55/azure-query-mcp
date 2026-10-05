import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { validateQuery } from "./query-policy.js";

export interface HuntingQuery {
  id: string;
  name: string;
  description: string;
  tactics: string[];
  techniques: string[];
  query: string;
  source: "built-in" | "directory";
}

const huntingQueryPolicy = { maxLength: 20_000, requireResultLimit: false };

export const builtInHuntingQueries: HuntingQuery[] = [
  {
    id: "password-spray",
    name: "Password spray from a single source IP",
    description: "One IP failing sign-in against many distinct accounts (Entra error 50126 invalid credentials, 50053 locked).",
    tactics: ["CredentialAccess"],
    techniques: ["T1110"],
    query: `SigninLogs
| where ResultType in ("50126", "50053")
| summarize FailedAccounts = dcount(UserPrincipalName), Attempts = count(),
    SampleAccounts = make_set(UserPrincipalName, 10), FirstSeen = min(TimeGenerated), LastSeen = max(TimeGenerated)
    by IPAddress
| where FailedAccounts >= 10
| sort by FailedAccounts desc`,
    source: "built-in",
  },
  {
    id: "mfa-fatigue",
    name: "MFA fatigue followed by a successful sign-in",
    description: "Repeated MFA denials or timeouts for one user (500121) followed by a success within an hour.",
    tactics: ["CredentialAccess"],
    techniques: ["T1621"],
    query: `let denials = SigninLogs
    | where ResultType == "500121"
    | summarize Denials = count(), FirstDenial = min(TimeGenerated), LastDenial = max(TimeGenerated) by UserPrincipalName
    | where Denials >= 5;
denials
| join kind=inner (
    SigninLogs | where ResultType == "0" | project UserPrincipalName, SuccessTime = TimeGenerated, IPAddress, AppDisplayName
  ) on UserPrincipalName
| where SuccessTime between (LastDenial .. (LastDenial + 1h))
| summarize arg_min(SuccessTime, *) by UserPrincipalName`,
    source: "built-in",
  },
  {
    id: "privileged-role-assignment",
    name: "New privileged Entra ID role assignment",
    description: "Members added to high-privilege directory roles, including who made the change.",
    tactics: ["Persistence", "PrivilegeEscalation"],
    techniques: ["T1098"],
    query: `AuditLogs
| where OperationName in ("Add member to role", "Add eligible member to role")
| extend Role = tostring(TargetResources[0].modifiedProperties[1].newValue),
         Target = tostring(TargetResources[0].userPrincipalName),
         Actor = coalesce(tostring(InitiatedBy.user.userPrincipalName), tostring(InitiatedBy.app.displayName))
| where Role has_any ("Global Administrator", "Privileged Role Administrator", "Security Administrator",
    "Exchange Administrator", "Application Administrator", "Cloud Application Administrator")
| project TimeGenerated, OperationName, Role, Target, Actor, Result`,
    source: "built-in",
  },
  {
    id: "inbox-forwarding-rule",
    name: "Inbox rule that forwards, redirects or deletes mail",
    description: "New or changed Exchange inbox rules with forwarding or deletion actions, a common BEC persistence step.",
    tactics: ["Collection", "Exfiltration"],
    techniques: ["T1114"],
    query: `OfficeActivity
| where Operation in~ ("New-InboxRule", "Set-InboxRule", "UpdateInboxRules")
| where Parameters has_any ("ForwardTo", "ForwardAsAttachmentTo", "RedirectTo", "DeleteMessage", "MoveToFolder")
| project TimeGenerated, UserId, ClientIP, Operation, Parameters`,
    source: "built-in",
  },
  {
    id: "office-app-spawns-shell",
    name: "Office application spawning a shell or script host",
    description: "Word, Excel, PowerPoint or Outlook launching cmd, PowerShell or script hosts, typical of malicious macros.",
    tactics: ["Execution"],
    techniques: ["T1204", "T1059"],
    query: `DeviceProcessEvents
| where InitiatingProcessFileName in~ ("winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe")
| where FileName in~ ("cmd.exe", "powershell.exe", "pwsh.exe", "wscript.exe", "cscript.exe", "mshta.exe", "rundll32.exe", "regsvr32.exe")
| project TimeGenerated, DeviceName, AccountName, InitiatingProcessFileName, FileName, ProcessCommandLine`,
    source: "built-in",
  },
];

/**
 * Loads hunting queries from JSON files in the SentinelCBContent hunting format
 * ({ id, name, description, tactics, techniques, query }). Each query must pass the
 * read-only policy. Invalid files are reported, not loaded.
 */
export function loadHuntingDirectory(directory: string): { queries: HuntingQuery[]; errors: string[] } {
  const queries: HuntingQuery[] = [];
  const errors: string[] = [];

  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(directory, file), "utf8")) as Record<string, unknown>;
      const { id, name, query } = raw;
      if (typeof id !== "string" || typeof name !== "string" || typeof query !== "string") {
        throw new Error("missing id, name or query");
      }
      validateQuery(query, huntingQueryPolicy);
      queries.push({
        id,
        name,
        description: typeof raw.description === "string" ? raw.description : "",
        tactics: Array.isArray(raw.tactics) ? raw.tactics.map(String) : [],
        techniques: Array.isArray(raw.techniques) ? raw.techniques.map(String) : [],
        query,
        source: "directory",
      });
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { queries, errors };
}

export class HuntingLibrary {
  readonly #queries = new Map<string, HuntingQuery>();
  readonly loadErrors: string[] = [];

  constructor(directory = process.env.AZURE_QUERY_MCP_HUNTING_DIR?.trim()) {
    for (const query of builtInHuntingQueries) {
      this.#queries.set(query.id, query);
    }
    if (directory) {
      const loaded = loadHuntingDirectory(directory);
      this.loadErrors.push(...loaded.errors);
      for (const query of loaded.queries) {
        if (this.#queries.has(query.id)) {
          this.loadErrors.push(`${query.id}: duplicate id, skipped`);
          continue;
        }
        this.#queries.set(query.id, query);
      }
    }
  }

  list() {
    return [...this.#queries.values()].map(({ query: _query, ...summary }) => summary);
  }

  get(id: string): HuntingQuery {
    const query = this.#queries.get(id);
    if (!query) {
      throw new Error(`Hunting query '${id}' was not found. Use list_hunting_queries to see available IDs.`);
    }
    return query;
  }

  static readonly policy = huntingQueryPolicy;
}
