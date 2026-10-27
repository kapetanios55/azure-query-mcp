# Log Analytics KQL for `query_workspace`

Every query below passes the server's read-only policy and resolves against the official Azure Monitor table schemas (the project's test suite checks both). Run each one with an explicit `timespan`; table availability depends on which connectors the workspace has.

## Before writing a query

1. Find the table: `search_tables` with a keyword (`sign`, `security`, `audit`).
2. Get exact column names and types: `describe_table`. Column names are case-sensitive, and some columns that look numeric are strings (`SigninLogs.ResultType` is a string: compare with `"0"`, not `0`).
3. Dynamic columns (JSON) need a cast before comparing or grouping: `tostring(LocationDetails.countryOrRegion)`.

## Patterns that keep queries cheap and correct

- Filter first, on `TimeGenerated` and other indexed columns, then project, then aggregate.
- `has` matches whole terms and is much faster than `contains`; use `has_any` for several terms.
- Use `summarize ... by` and `top N by` rather than returning raw rows; return raw rows only with `take` and a narrow `project`.
- `summarize arg_max(TimeGenerated, *) by Key` returns the latest row per key (for example the current state of each incident).
- `bin(TimeGenerated, 1h)` buckets time for trends.
- Joins: put the smaller table on the left and filter both sides first.

## Identity and sign-ins

Users with the most failed sign-ins:

```kusto
SigninLogs
| where ResultType != "0"
| summarize Failures = count(), Apps = make_set(AppDisplayName, 5), LastFailure = max(TimeGenerated) by UserPrincipalName
| top 20 by Failures desc
```

Users signing in successfully from several countries:

```kusto
SigninLogs
| where ResultType == "0"
| extend Country = tostring(LocationDetails.countryOrRegion)
| summarize Countries = make_set(Country, 10), CountryCount = dcount(Country) by UserPrincipalName
| where CountryCount > 2
| top 20 by CountryCount desc
```

Directory changes made by one administrator:

```kusto
AuditLogs
| where tostring(InitiatedBy.user.userPrincipalName) =~ "admin@contoso.com"
| project TimeGenerated, OperationName, Result, Target = tostring(TargetResources[0].displayName)
| sort by TimeGenerated desc
| take 50
```

## Azure control-plane activity

Who deleted the most resources (the word `delete` is fine inside a string):

```kusto
AzureActivity
| where OperationNameValue endswith "/delete" and ActivityStatusValue in~ ("Success", "Succeeded")
| summarize Deletes = count(), Resources = make_set(_ResourceId, 10) by Caller
| top 20 by Deletes desc
```

## Windows and endpoint security

Accounts with the most failed Windows logons:

```kusto
SecurityEvent
| where EventID == 4625
| summarize FailedLogons = count(), Computers = dcount(Computer) by Account
| top 20 by FailedLogons desc
```

Encoded PowerShell command lines:

```kusto
DeviceProcessEvents
| where FileName in~ ("powershell.exe", "pwsh.exe")
| where ProcessCommandLine has_any ("-enc", "-EncodedCommand")
| project TimeGenerated, DeviceName, AccountName, InitiatingProcessFileName, ProcessCommandLine
| sort by TimeGenerated desc
| take 50
```

## Alerts and incidents

Alert volume per day and severity:

```kusto
SecurityAlert
| summarize Alerts = count() by Day = bin(TimeGenerated, 1d), AlertSeverity
| sort by Day asc
```

For incident lists and details, use `list_incidents` and `get_incident` instead of querying `SecurityIncident` directly.

## Cost and volume

Billable ingestion by table, in GB:

```kusto
Usage
| where IsBillable == true
| summarize IngestedGB = round(sum(Quantity) / 1024, 2) by DataType
| top 20 by IngestedGB desc
```
