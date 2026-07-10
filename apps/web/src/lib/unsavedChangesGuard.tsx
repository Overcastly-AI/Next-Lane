/**
 * UnsavedChangesGuard — app-wide "you have unsaved edits" protection.
 *
 * Today the only registrant is the Pages editor (`PageEditor.tsx`), but the
 * mechanism is deliberately generic so any future long-form editing surface
 * (issue description drafts, settings forms, etc.) can opt in the same way.
 *
 * Two protections, driven by one `isBlocking` flag:
 *  1. `beforeunload` — the browser's own confirmation on reload / tab close /
 *     navigating to a different origin. Can't be themed (HTML5 spec), but is
 *     the only mechanism that can stop a hard navigation.
 *  2. In-app navigation — anything driven by our own router (page-tree
 *     clicks, the Document/Graph toggle, `ProjectNav`'s tabs) calls
 *     `confirmDiscard()` before navigating away and gets a themed
 *     `ConfirmDialog` (built on the same primitive used by every other
 *     destructive-action confirm in the app, e.g. delete-page).
 *
 * Registrants call `setBlocking(dirty)` from an effect keyed on their own
 * dirty state; the LAST call wins, which is fine because only one
 * unsaved-changes-sensitive surface (the page editor) is ever mounted and
 * "dirty" at a time in this app today.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export interface UnsavedChangesGuardValue {
  /** True while some surface has unsaved edits that should block navigation. */
  isBlocking: boolean;
  /** Register/clear the active guard. Call with `false` on save/cancel/discard. */
  setBlocking: (active: boolean) => void;
  /**
   * Ask permission to proceed with an in-app navigation. Resolves `true`
   * immediately when nothing is blocking; otherwise shows a themed confirm
   * dialog and resolves with the user's choice (`true` = discard and go,
   * `false` = stay).
   */
  confirmDiscard: () => Promise<boolean>;
}

const UnsavedChangesGuardContext = createContext<UnsavedChangesGuardValue | null>(null);

export function UnsavedChangesGuardProvider({ children }: { children: ReactNode }) {
  const [isBlocking, setIsBlocking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  // Effects below read the latest `isBlocking` via a ref so `confirmDiscard`
  // (referenced by many callers) doesn't need to change identity every time
  // blocking toggles.
  const blockingRef = useRef(isBlocking);
  blockingRef.current = isBlocking;

  const setBlocking = useCallback((active: boolean) => {
    setIsBlocking(active);
  }, []);

  const confirmDiscard = useCallback((): Promise<boolean> => {
    if (!blockingRef.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setConfirmOpen(true);
    });
  }, []);

  function resolveConfirm(result: boolean) {
    setConfirmOpen(false);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    // Clear the guard on a confirmed discard so nothing double-prompts
    // (the caller performs the navigation right after this resolves).
    if (result) setIsBlocking(false);
    resolve?.(result);
  }

  // Native guard for reload / tab close / navigating to a different origin —
  // the one thing our own router can't intercept.
  useEffect(() => {
    if (!isBlocking) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Chrome requires returnValue to be set; the string itself is ignored
      // by every modern browser in favor of a fixed, non-customizable message.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isBlocking]);

  const value = useMemo<UnsavedChangesGuardValue>(
    () => ({ isBlocking, setBlocking, confirmDiscard }),
    [isBlocking, setBlocking, confirmDiscard],
  );

  return (
    <UnsavedChangesGuardContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={confirmOpen}
        title="Discard unsaved changes?"
        message="You have unsaved edits. If you leave now, they'll be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </UnsavedChangesGuardContext.Provider>
  );
}

/** Read/drive the app-wide unsaved-changes guard. Must be used under `UnsavedChangesGuardProvider`. */
export function useUnsavedChangesGuard(): UnsavedChangesGuardValue {
  const ctx = useContext(UnsavedChangesGuardContext);
  if (!ctx) {
    throw new Error('useUnsavedChangesGuard must be used within an UnsavedChangesGuardProvider');
  }
  return ctx;
}
