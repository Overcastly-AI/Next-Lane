import { useOutletContext } from 'react-router-dom';
import type { ProjectDto, Role, StatusDto, UserDto } from '@next-lane/shared';

/**
 * What the settings layout route fetches once and every group page reads.
 *
 * It is an outlet context rather than six pages each running their own
 * `useProject`/`useMyRole`/`useStatuses` because the rail makes switching
 * groups a route change: per-page fetching would re-suspend the whole screen
 * on every rail click, which is exactly the "it feels slow and jumpy" the
 * redesign is meant to remove.
 */
export interface ProjectSettingsContext {
  projectId: string;
  /** The project, guaranteed loaded — the layout renders its own loading and
   *  error states and only mounts the outlet once this exists. */
  project: ProjectDto;
  myRole: Role | null | undefined;
  /** ADMIN or MEMBER. */
  editable: boolean;
  isAdmin: boolean;
  /** Sorted by `order` — WorkflowSection and the integrations expect that. */
  statuses: StatusDto[];
  /** Workspace members, for the components section's assignee picker. */
  workspaceUsers: UserDto[];
}

export function useProjectSettings(): ProjectSettingsContext {
  return useOutletContext<ProjectSettingsContext>();
}
