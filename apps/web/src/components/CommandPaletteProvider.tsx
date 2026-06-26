import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CommandPalette } from './CommandPalette';
import { useAuth } from '@/auth/AuthContext';

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
