import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
import { ShortcutsHelpModal } from './ShortcutsHelpModal';
import { useGlobalShortcuts } from '@/lib/useGlobalShortcuts';

/** Window event the palette's "Keyboard shortcuts" command dispatches. */
export const SHOW_SHORTCUTS_EVENT = 'nl:show-shortcuts';
import { useAuth } from '@/auth/AuthContext';
import { useIssue } from '@/api/issues';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { recordRecentIssue } from '@/lib/recentIssues';

interface CommandPaletteContextValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: boolean;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

/**
 * Hosts the global command palette and the Cmd-K / Ctrl-K shortcut. Mount this
 * inside the Router (the palette navigates) and around the authenticated app so
 * any screen can open it via {@link useCommandPalette}.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Record "recently viewed" issues by observing the `?issue=` URL param, so
  // every surface that opens the drawer (board, backlog, deep links, palette)
  // is covered without each one having to report in.
  const { search } = useLocation();
  const { activeWorkspace } = useWorkspaceContext();
  const viewedIssueId = isAuthenticated
    ? (new URLSearchParams(search).get('issue') ?? undefined)
    : undefined;
  const viewedIssue = useIssue(viewedIssueId);
  const viewed = viewedIssue.data;
  const workspaceId = activeWorkspace?.id;
  useEffect(() => {
    if (!viewed || viewed.id !== viewedIssueId || !workspaceId) return;
    recordRecentIssue(workspaceId, {
      id: viewed.id,
      key: viewed.key,
      title: viewed.title,
      projectId: viewed.projectId,
      type: viewed.type,
    });
  }, [viewed, viewedIssueId, workspaceId]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Cmd-K / Ctrl-K toggles the palette, but only for signed-in users.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAuthenticated]);

  const showHelp = useCallback(() => {
    setIsOpen(false);
    setHelpOpen(true);
  }, []);
  useGlobalShortcuts({ enabled: isAuthenticated, onShowHelp: showHelp });
  useEffect(() => {
    if (!isAuthenticated) return;
    window.addEventListener(SHOW_SHORTCUTS_EVENT, showHelp);
    return () => window.removeEventListener(SHOW_SHORTCUTS_EVENT, showHelp);
  }, [isAuthenticated, showHelp]);

  // Never leave the palette open after signing out.
  useEffect(() => {
    if (!isAuthenticated && isOpen) setIsOpen(false);
  }, [isAuthenticated, isOpen]);

  const value = useMemo(
    () => ({ open, close, toggle, isOpen }),
    [open, close, toggle, isOpen],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      {isAuthenticated && <CommandPalette open={isOpen} onClose={close} />}
      {isAuthenticated && (
        <ShortcutsHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      )}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error(
      'useCommandPalette must be used within a CommandPaletteProvider',
    );
  }
  return ctx;
}
