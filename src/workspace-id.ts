export interface WorkspaceResource {
  subscriptionId: string;
  resourceGroupName: string;
  workspaceName: string;
}

const workspaceResourceId = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.OperationalInsights\/workspaces\/([^/]+)\/?$/i;

export function parseWorkspaceResourceId(resourceId: string): WorkspaceResource {
  const match = workspaceResourceId.exec(resourceId.trim());

  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error("workspaceResourceId must be a full Log Analytics workspace ARM resource ID.");
  }

  return {
    subscriptionId: match[1],
    resourceGroupName: match[2],
    workspaceName: match[3],
  };
}