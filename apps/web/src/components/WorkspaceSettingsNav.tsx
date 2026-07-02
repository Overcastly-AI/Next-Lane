/**
 * Shared sub-navigation bar for all workspace settings pages.
 *
 * Tabs: General / Members / Audit log / Branding
 *
 * Used by:
 *  - WorkspaceSettingsPage  (/workspaces/:id/settings)
 *  - WorkspaceMembersPage   (/workspaces/:id/members)
 *  - WorkspaceAuditLogPage  (/workspaces/:id/audit-log)
 *  - WorkspaceBrandingPage  (/workspaces/:id/branding)
 */
import { NavLink } from 'react-router-dom';

interface WorkspaceSettingsNavProps {
  workspaceId: string;
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive
      ? 'bg-signal-50 text-signal-700'
      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
  }`;

export function WorkspaceSettingsNav({ workspaceId }: WorkspaceSettingsNavProps) {
  return (
    <nav
      className="flex items-center gap-1 border-b border-ink-100 bg-surface px-4 py-1"
      aria-label="Workspace settings navigation"
      data-testid="workspace-settings-nav"
    >
      <NavLink
        to={`/workspaces/${workspaceId}/settings`}
        className={navLinkClass}
      >
        General
      </NavLink>
      <NavLink
        to={`/workspaces/${workspaceId}/members`}
        className={navLinkClass}
      >
        Members
      </NavLink>
      <NavLink
        to={`/workspaces/${workspaceId}/audit-log`}
        className={navLinkClass}
      >
        Audit log
      </NavLink>
      <NavLink
        to={`/workspaces/${workspaceId}/branding`}
        className={navLinkClass}
      >
        Branding
      </NavLink>
    </nav>
  );
}
