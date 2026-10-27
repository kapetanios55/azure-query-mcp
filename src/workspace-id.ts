export interface WorkspaceResource {
  subscriptionId: string;
  resourceGroupName: string;
  workspaceName: string;
}

/** A workspace named by its customer ID (GUID) or by its full ARM resource ID. */
export type WorkspaceRef =
  | { kind: "id"; workspaceId: string }
  | ({ kind: "resource"; resourceId: string } & WorkspaceResource);

const workspaceResourceId = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.OperationalInsights\/workspaces\/([^/]+)\/?$/i;
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWorkspaceResourceId(resourceId: string): WorkspaceResource {
  const trimmed = resourceId.trim();
  const match = workspaceResourceId.exec(trimmed);

  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(
      guid.test(trimmed)
        ? "workspaceResourceId must be the workspace's full ARM resource ID, not its workspace ID (GUID); list_workspaces returns it as resourceId."
        : "workspaceResourceId must be a full Log Analytics workspace ARM resource ID.",
    );
  }

  return {
    subscriptionId: match[1],
    resourceGroupName: match[2],
    workspaceName: match[3],
  };
}

export function parseWorkspaceRef(value: string): WorkspaceRef {
  const trimmed = value.trim();
  if (guid.test(trimmed)) {
    return { kind: "id", workspaceId: trimmed };
  }
  if (workspaceResourceId.test(trimmed)) {
    return { kind: "resource", resourceId: trimmed, ...parseWorkspaceResourceId(trimmed) };
  }
  throw new Error("workspaceId must be a Log Analytics workspace ID (GUID) or the workspace's full ARM resource ID; list_workspaces returns both.");
}
