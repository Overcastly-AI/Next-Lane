import { useNavigate } from 'react-router-dom';
import type { WorkspaceDto } from '@next-lane/shared';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';

/**
 * Shared "pick a workspace from a switcher" behavior.
 *
 * Both the header `WorkspaceChip` and the sidebar's workspace switcher call
 * this so the two surfaces can never drift into separate copies of the same
 * logic — they both read/write the single `WorkspaceContext` and both land
 * on `/` after switching away from the current workspace so the visible
 * content re-scopes (matches the pre-existing chip behavior exactly).
 */
export function useSwitchWorkspace(): (ws: WorkspaceDto) => void {
  const { activeWorkspace, setActiveWorkspaceId } = useWorkspaceContext();
  const navigate = useNavigate();

  return (ws: WorkspaceDto) => {
    setActiveWorkspaceId(ws.id);
    // Land on the newly-active workspace's home so the content re-scopes —
    // otherwise switching only recolors chrome while the page underneath
    // still shows the previous workspace's content.
    if (activeWorkspace && ws.id !== activeWorkspace.id) navigate('/');
  };
}
