# Azure Resource Graph KQL for `query_azure_resources`

Every query below passes the server's read-only policy (the project's test suite checks this). ARG has no published schema to check columns against, so if a property path returns nothing, inspect one resource first with `| project properties | limit 1`.

Always pass the subscriptions to search in `subscriptionIds`. ARG data is control-plane state and can lag a few minutes behind changes.

## Which table

| Table | Holds |
| --- | --- |
| `Resources` | Most resource types and their properties. The default choice. |
| `ResourceContainers` | Subscriptions, resource groups and management groups. |
| `AuthorizationResources` | Role assignments and role definitions (RBAC). |
| `PolicyResources` | Policy assignments, definitions and compliance states. |
| `SecurityResources` | Microsoft Defender for Cloud assessments, secure score, alerts. |
| `ResourceChanges` | Property changes to resources over the last 14 days. |
| `ResourceContainerChanges` | Changes to subscriptions and resource groups. |
| `AdvisorResources`, `HealthResources`, `NetworkResources`, `AppServiceResources`, ... | Service-specific data. Run `distinct type` against a table to see which resource types it holds. |

## Patterns

- Filter on `type` first, with `=~` (resource types are case-insensitive): `where type =~ 'microsoft.compute/virtualmachines'`.
- Properties are dynamic: cast before comparing (`tostring(properties.provisioningState)`, `tobool(...)`, `toint(...)`).
- Property names that collide with blocked words need brackets: `properties['delete']`.
- `mv-expand` turns an array property (NSG rules, IP configurations) into rows.
- Join `ResourceContainers` on `subscriptionId` to add subscription names.

## Inventory

Resources per type:

```kusto
Resources
| summarize ResourceCount = count() by type
| top 25 by ResourceCount desc
```

Subscriptions and their state (subscription IDs still have to be passed in `subscriptionIds`):

```kusto
ResourceContainers
| where type =~ 'microsoft.resources/subscriptions'
| project subscriptionId, name, state = tostring(properties.state)
| limit 100
```

Resources missing an owner tag:

```kusto
Resources
| where isempty(tags.owner)
| project id, name, type, resourceGroup, subscriptionId
| order by type asc, name asc
| limit 100
```

## Exposure

Public IP addresses and what they are attached to:

```kusto
Resources
| where type =~ 'microsoft.network/publicipaddresses'
| project name, resourceGroup, subscriptionId, ipAddress = tostring(properties.ipAddress), attachedTo = tostring(properties.ipConfiguration.id)
| limit 100
```

Storage accounts that allow anonymous blob access:

```kusto
Resources
| where type =~ 'microsoft.storage/storageaccounts'
| where tobool(properties.allowBlobPublicAccess) == true
| project name, resourceGroup, subscriptionId, location
| limit 100
```

Key vaults without purge protection:

```kusto
Resources
| where type =~ 'microsoft.keyvault/vaults'
| where isnull(properties.enablePurgeProtection) or tobool(properties.enablePurgeProtection) == false
| project name, resourceGroup, subscriptionId, location
| limit 100
```

NSG rules allowing inbound SSH (port 22) from the internet, including port ranges and wildcards. Change `targetPort` for another port. This finds candidate exposure only: it does not account for rule priority, NIC and subnet associations, routes, firewalls or whether anything listens on the port.

```kusto
Resources
| where type =~ 'microsoft.network/networksecuritygroups'
| mv-expand rule = properties.securityRules
| where tostring(rule.properties.direction) =~ 'Inbound' and tostring(rule.properties.access) =~ 'Allow'
| extend sourcePrefixes = iif(array_length(rule.properties.sourceAddressPrefixes) > 0, rule.properties.sourceAddressPrefixes, pack_array(rule.properties.sourceAddressPrefix)),
         destinationPorts = iif(array_length(rule.properties.destinationPortRanges) > 0, rule.properties.destinationPortRanges, pack_array(rule.properties.destinationPortRange))
| mv-expand sourcePrefix = sourcePrefixes
| where tostring(sourcePrefix) in~ ('*', 'Internet', '0.0.0.0/0', '::/0')
| mv-expand destinationPort = destinationPorts
| extend portText = tostring(destinationPort), targetPort = 22
| extend rangeStart = toint(split(portText, '-')[0]), rangeEnd = toint(split(portText, '-')[1])
| where portText == '*' or targetPort == toint(portText) or (rangeStart <= targetPort and rangeEnd >= targetPort)
| project nsg = name, resourceGroup, subscriptionId, ruleName = tostring(rule.name), portText, sourcePrefix = tostring(sourcePrefix)
| limit 200
```

## Access (RBAC)

Who holds Owner, User Access Administrator or Contributor, and where:

```kusto
AuthorizationResources
| where type =~ 'microsoft.authorization/roleassignments'
| extend roleDefinitionId = tolower(tostring(properties.roleDefinitionId)), principalId = tostring(properties.principalId),
         principalType = tostring(properties.principalType), scope = tostring(properties.scope)
| join kind=inner (
    AuthorizationResources
    | where type =~ 'microsoft.authorization/roledefinitions'
    | extend roleDefinitionId = tolower(id), roleName = tostring(properties.roleName)
    | where roleName in ('Owner', 'User Access Administrator', 'Contributor')
    | project roleDefinitionId, roleName
  ) on roleDefinitionId
| project principalId, principalType, roleName, scope
| limit 200
```

The result has principal object IDs, not names; ask the user before resolving them elsewhere.

## Compliance and posture

Policies with the most non-compliant resources:

```kusto
PolicyResources
| where type =~ 'microsoft.policyinsights/policystates'
| where tostring(properties.complianceState) =~ 'NonCompliant'
| summarize NonCompliantResources = dcount(tostring(properties.resourceId)) by policyAssignment = tostring(properties.policyAssignmentName), policyDefinition = tostring(properties.policyDefinitionName)
| top 25 by NonCompliantResources desc
```

Defender for Cloud recommendations with the most unhealthy resources:

```kusto
SecurityResources
| where type =~ 'microsoft.security/assessments'
| where tostring(properties.status.code) =~ 'Unhealthy'
| summarize UnhealthyResources = count() by recommendation = tostring(properties.displayName), severity = tostring(properties.metadata.severity)
| top 25 by UnhealthyResources desc
```

## Changes

Resource changes in the last day, newest first:

```kusto
ResourceChanges
| extend changeTime = todatetime(properties.changeAttributes.timestamp), targetResourceId = tostring(properties.targetResourceId),
         changeType = tostring(properties.changeType), changedBy = tostring(properties.changeAttributes.changedBy),
         operation = tostring(properties.changeAttributes.operation)
| where changeTime > ago(1d)
| project changeTime, changeType, targetResourceId, changedBy, operation
| order by changeTime desc
| limit 100
```

To see who made a change and from where, follow up in the workspace with `AzureActivity` filtered on the same resource ID.
