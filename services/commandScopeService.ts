// Pure scope selection. A platform role is a capability, never the default inventory scope.
export type CommandReportScope = 'workspace' | 'platform';
export function resolveCommandReportScope(canViewPlatform: boolean, selected: CommandReportScope, selectedUserId: string, userId: string): CommandReportScope {
  return canViewPlatform && Boolean(userId) && selectedUserId === userId && selected === 'platform' ? 'platform' : 'workspace';
}
export function commandScopeLabel(platform: boolean, workspaceName: string | null | undefined, tenantId: string | null | undefined): string {
  if (platform) return 'All workspaces · records are counted separately per workspace';
  if (!tenantId) return 'Workspace not verified';
  return `${workspaceName?.trim() || 'Current workspace'} · ${tenantId.slice(0, 8)} · this workspace only`;
}
