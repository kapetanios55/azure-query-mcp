import { isIP } from "node:net";

/**
 * KQL builders for the SOC tools. Every user-supplied value is validated against a
 * strict pattern before it is placed in a query: the Log Analytics query API has no
 * parameter binding, so validation is the injection boundary. Accepted values never
 * contain quotes, backslashes or whitespace.
 */

export type EntityType = "account" | "ip" | "host";
export const incidentStatuses = ["New", "Active", "Closed"] as const;
export const incidentSeverities = ["High", "Medium", "Low", "Informational"] as const;

const accountPattern = /^[A-Za-z0-9._%+-]{1,128}(?:@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)?$/;
const hostPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*$/;

export function validateEntity(type: EntityType, value: string): string {
  const trimmed = value.trim();
  const valid = type === "ip"
    ? isIP(trimmed) !== 0
    : type === "account"
      ? accountPattern.test(trimmed)
      : hostPattern.test(trimmed) && trimmed.length <= 253;

  if (!valid) {
    const expected = { account: "a UPN (user@domain) or account name", ip: "an IPv4 or IPv6 address", host: "a hostname or FQDN" }[type];
    throw new Error(`Entity value is not ${expected}.`);
  }
  return trimmed;
}

const literal = (value: string) => `"${value}"`;

// Every leg projects the same columns so the union renders as one timeline.
const timelineColumns = "TimeGenerated, Source, Activity, Account, IPAddress, Host, Details";

function accountLegs(upn: string): string[] {
  const name = literal(upn.split("@")[0] ?? upn);
  const full = literal(upn);
  return [
    `SigninLogs | where UserPrincipalName =~ ${full}
      | project TimeGenerated, Source = "SigninLogs",
          Activity = strcat("Sign-in to ", AppDisplayName, iff(ResultType == "0", " succeeded", strcat(" failed (", ResultType, ")"))),
          Account = UserPrincipalName, IPAddress, Host = "", Details = tostring(LocationDetails.countryOrRegion)`,
    `AuditLogs | where tostring(InitiatedBy.user.userPrincipalName) =~ ${full} or tostring(TargetResources) has ${full}
      | project TimeGenerated, Source = "AuditLogs", Activity = OperationName,
          Account = tostring(InitiatedBy.user.userPrincipalName), IPAddress = tostring(InitiatedBy.user.ipAddress),
          Host = "", Details = Result`,
    `OfficeActivity | where UserId =~ ${full}
      | project TimeGenerated, Source = "OfficeActivity", Activity = Operation, Account = UserId,
          IPAddress = ClientIP, Host = "", Details = OfficeWorkload`,
    // DeviceLogonEvents has no UPN column; AccountName holds the short account name.
    `DeviceLogonEvents | where AccountName =~ ${name}
      | project TimeGenerated, Source = "DeviceLogonEvents", Activity = strcat(ActionType, " (", LogonType, ")"),
          Account = AccountName, IPAddress = RemoteIP, Host = DeviceName, Details = ""`,
    `SecurityAlert | where Entities has ${full}
      | project TimeGenerated, Source = "SecurityAlert", Activity = AlertName, Account = ${full},
          IPAddress = "", Host = CompromisedEntity, Details = AlertSeverity`,
  ];
}

function ipLegs(ip: string): string[] {
  const value = literal(ip);
  return [
    `SigninLogs | where IPAddress == ${value}
      | project TimeGenerated, Source = "SigninLogs",
          Activity = strcat("Sign-in to ", AppDisplayName, iff(ResultType == "0", " succeeded", strcat(" failed (", ResultType, ")"))),
          Account = UserPrincipalName, IPAddress, Host = "", Details = tostring(LocationDetails.countryOrRegion)`,
    `AzureActivity | where CallerIpAddress == ${value}
      | project TimeGenerated, Source = "AzureActivity", Activity = OperationNameValue, Account = Caller,
          IPAddress = CallerIpAddress, Host = "", Details = ActivityStatusValue`,
    `OfficeActivity | where ClientIP == ${value}
      | project TimeGenerated, Source = "OfficeActivity", Activity = Operation, Account = UserId,
          IPAddress = ClientIP, Host = "", Details = OfficeWorkload`,
    `DeviceNetworkEvents | where RemoteIP == ${value} or LocalIP == ${value}
      | project TimeGenerated, Source = "DeviceNetworkEvents", Activity = strcat(ActionType, " ", InitiatingProcessFileName, " -> ", RemoteIP, ":", RemotePort),
          Account = InitiatingProcessAccountName, IPAddress = RemoteIP, Host = DeviceName, Details = RemoteUrl`,
    `CommonSecurityLog | where SourceIP == ${value} or DestinationIP == ${value}
      | project TimeGenerated, Source = "CommonSecurityLog", Activity = strcat(DeviceVendor, " ", DeviceProduct, ": ", Activity),
          Account = SourceUserName, IPAddress = SourceIP, Host = DestinationHostName, Details = DeviceAction`,
    `SecurityAlert | where Entities has ${value}
      | project TimeGenerated, Source = "SecurityAlert", Activity = AlertName, Account = "",
          IPAddress = ${value}, Host = CompromisedEntity, Details = AlertSeverity`,
  ];
}

function hostLegs(host: string): string[] {
  const value = literal(host);
  const matchesDevice = `(DeviceName =~ ${value} or DeviceName startswith strcat(${value}, "."))`;
  return [
    `DeviceProcessEvents | where ${matchesDevice}
      | project TimeGenerated, Source = "DeviceProcessEvents", Activity = strcat(InitiatingProcessFileName, " -> ", FileName),
          Account = AccountName, IPAddress = "", Host = DeviceName, Details = ProcessCommandLine`,
    `DeviceLogonEvents | where ${matchesDevice}
      | project TimeGenerated, Source = "DeviceLogonEvents", Activity = strcat(ActionType, " (", LogonType, ")"),
          Account = AccountName, IPAddress = RemoteIP, Host = DeviceName, Details = ""`,
    `DeviceNetworkEvents | where ${matchesDevice} and RemoteIPType == "Public"
      | project TimeGenerated, Source = "DeviceNetworkEvents", Activity = strcat(ActionType, " ", InitiatingProcessFileName, " -> ", RemoteIP, ":", RemotePort),
          Account = InitiatingProcessAccountName, IPAddress = RemoteIP, Host = DeviceName, Details = RemoteUrl`,
    `SecurityEvent | where Computer =~ ${value} or Computer startswith strcat(${value}, ".")
      | where EventID in (4624, 4625, 4688, 4720, 4732)
      | project TimeGenerated, Source = "SecurityEvent", Activity = Activity, Account = Account,
          IPAddress = IpAddress, Host = Computer, Details = CommandLine`,
    `SecurityAlert | where CompromisedEntity =~ ${value} or Entities has ${value}
      | project TimeGenerated, Source = "SecurityAlert", Activity = AlertName, Account = "",
          IPAddress = "", Host = CompromisedEntity, Details = AlertSeverity`,
  ];
}

function timelineUnion(type: EntityType, value: string): string {
  const legs = type === "account" ? accountLegs(value) : type === "ip" ? ipLegs(value) : hostLegs(value);
  // isfuzzy keeps the query working when a connector (and so its table) is absent.
  return `union isfuzzy=true\n${legs.map((leg) => `  (${leg})`).join(",\n")}\n| project ${timelineColumns}`;
}

export function entityTimelineQuery(type: EntityType, value: string, maxEvents: number): string {
  const entity = validateEntity(type, value);
  return `${timelineUnion(type, entity)}\n| sort by TimeGenerated desc\n| take ${Math.trunc(maxEvents)}`;
}

export function entityTimelineSummaryQuery(type: EntityType, value: string): string {
  const entity = validateEntity(type, value);
  return `${timelineUnion(type, entity)}\n| summarize Events = count(), FirstSeen = min(TimeGenerated), LastSeen = max(TimeGenerated) by Source\n| sort by Events desc`;
}

export interface IncidentFilters {
  statuses?: readonly string[] | undefined;
  severities?: readonly string[] | undefined;
  maxResults: number;
}

function inList(column: string, values: readonly string[] | undefined, allowed: readonly string[]): string {
  if (!values?.length) {
    return "";
  }
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new Error(`KQL query filter value '${value}' is not allowed for ${column}.`);
    }
  }
  return `\n| where ${column} in~ (${values.map(literal).join(", ")})`;
}

export function listIncidentsQuery(filters: IncidentFilters): string {
  // SecurityIncident stores a row per update; arg_max keeps each incident's latest state.
  return `SecurityIncident
| summarize arg_max(TimeGenerated, *) by IncidentNumber${inList("Status", filters.statuses, incidentStatuses)}${inList("Severity", filters.severities, incidentSeverities)}
| project IncidentNumber, Title, Severity, Status, Classification, Owner = tostring(Owner.assignedTo),
    CreatedTime, LastModifiedTime, AlertCount = array_length(AlertIds), Tactics = tostring(AdditionalData.tactics), IncidentUrl
| sort by CreatedTime desc
| take ${Math.trunc(filters.maxResults)}`;
}

function incidentNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("KQL query incident number must be a positive integer.");
  }
  return value;
}

export function incidentDetailQuery(number: number): string {
  return `SecurityIncident
| where IncidentNumber == ${incidentNumber(number)}
| summarize arg_max(TimeGenerated, *) by IncidentNumber
| project IncidentNumber, Title, Description, Severity, Status, Classification, ClassificationReason,
    Owner = tostring(Owner.assignedTo), CreatedTime, FirstActivityTime, LastActivityTime,
    Labels = tostring(Labels), Tactics = tostring(AdditionalData.tactics), IncidentUrl
| take 1`;
}

export function incidentAlertsQuery(number: number): string {
  return `let alertIds = SecurityIncident
    | where IncidentNumber == ${incidentNumber(number)}
    | summarize arg_max(TimeGenerated, AlertIds) by IncidentNumber
    | mv-expand AlertId = AlertIds to typeof(string)
    | project AlertId;
SecurityAlert
| where SystemAlertId in (alertIds)
| summarize arg_max(TimeGenerated, *) by SystemAlertId
| project TimeGenerated, AlertName, AlertSeverity, ProviderName, Tactics, Techniques, CompromisedEntity, Description, Entities
| sort by TimeGenerated asc
| take 50`;
}

export function ingestionVolumeQuery(staleAfterHours: number): string {
  const hours = Math.trunc(staleAfterHours);
  // Usage is pre-aggregated hourly per table, so this is cheap even over long windows.
  return `Usage
| summarize LastSeen = max(TimeGenerated), TotalMB = sum(Quantity),
    Last24hMB = sumif(Quantity, TimeGenerated > ago(1d)),
    EarlierMB = sumif(Quantity, TimeGenerated <= ago(1d)),
    EarlierDays = dcountif(bin(TimeGenerated, 1d), TimeGenerated <= ago(1d))
    by DataType, IsBillable
| extend PrevDailyAvgMB = iff(EarlierDays > 0, EarlierMB / EarlierDays, real(null))
| extend ChangePct = iff(PrevDailyAvgMB > 0, round(100.0 * (Last24hMB - PrevDailyAvgMB) / PrevDailyAvgMB, 1), real(null))
| extend HoursSinceLastSeen = datetime_diff('hour', now(), LastSeen)
| extend Status = case(HoursSinceLastSeen > ${hours}, "Stale",
                       ChangePct <= -50, "VolumeDrop",
                       ChangePct >= 200, "VolumeSpike",
                       "Healthy")
| extend Rank = case(Status == "Stale", 0, Status == "VolumeDrop", 1, Status == "VolumeSpike", 2, 3)
| project DataType, Status, LastSeen, HoursSinceLastSeen, Last24hMB = round(Last24hMB, 2),
    PrevDailyAvgMB = round(PrevDailyAvgMB, 2), ChangePct, TotalMB = round(TotalMB, 2), IsBillable, Rank
| sort by Rank asc, TotalMB desc
| project-away Rank
| take 200`;
}

export function ingestionLatencyQuery(): string {
  // Sampled over the last hour only: union * over a long window is expensive.
  return `union withsource=TableName *
| where TimeGenerated > ago(1h)
| extend LatencySec = datetime_diff('second', ingestion_time(), TimeGenerated)
| summarize Events = count(), MedianLatencySec = percentile(LatencySec, 50), P95LatencySec = percentile(LatencySec, 95) by TableName
| sort by P95LatencySec desc
| take 100`;
}
