# Security Policy

## Supported versions

Security fixes are provided for the latest release on the default branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository and include affected versions, reproduction steps, impact, and any proposed mitigation. Do not include production credentials or customer data.

## Production deployment baseline

- Run a dedicated managed identity or workload identity per environment.
- Set `AZURE_TOKEN_CREDENTIALS=prod` to exclude developer credentials in production.
- Grant only Reader access at the smallest necessary subscription, resource group, or resource scope.
- Grant Log Analytics Reader only on workspaces that must be queried.
- Do not grant Owner, Contributor, User Access Administrator, or data-ingestion roles.
- Keep the MCP server local to the trusted host or place any remote transport behind authenticated TLS and explicit authorization. This release provides stdio only.
- Use an allowlisted MCP client and review tool calls before execution in high-impact environments.
- Do not expose secrets through MCP arguments, query text, logs, command-line arguments, or committed configuration.
- Pin container images by digest, run as non-root with a read-only filesystem, drop Linux capabilities, and deny privilege escalation.
- Restrict outbound network access to Microsoft Entra ID, Azure Resource Manager, and the Azure Monitor query endpoint required by the selected cloud.
- Retain Azure activity and sign-in logs, but do not log query results or access tokens.
- Run `npm ci`, `npm run check`, and `npm audit --omit=dev` for every release.

## Trust boundaries and residual risks

The server executes user-supplied read-only query text under the caller's Azure identity. Read-only access can still disclose sensitive resource metadata or log content. Query policy reduces accidental misuse but is not a substitute for least-privilege RBAC, network controls, data classification, and review of the connected MCP client.

Azure Resource Graph can return resource properties and tags that contain sensitive values. Avoid storing secrets in tags or resource metadata. Log Analytics data may contain personal or security-sensitive records. Scope identities and workspaces accordingly.

The server does not persist results. The MCP client or model host may retain prompts and tool outputs under its own data-handling policy; assess that system separately before production use.
