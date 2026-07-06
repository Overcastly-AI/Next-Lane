import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useOverlay } from '@/lib/useOverlay';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class, e.g. 'max-w-lg'. */
  size?: string;
  /** ARIA role for the dialog container. Use 'alertdialog' for destructive confirmations. */
  role?: 'dialog' | 'alertdialog';
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'max-w-lg',
  role = 'dialog',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useOverlay({ open, onClose, containerRef: panelRef });

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role={role}
      aria-modal="true"
      aria-labelledby={title !== undefined ? titleId : undefined}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-scrim/35 backdrop-blur-[2px] animate-nl-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel — capped at viewport height with a scrollable body so a tall
          form's header stays reachable and its footer action row never runs
          off-screen (see docs/UI-REVIEW.md 2026-07-06 mobile-toast fix's
          noted residual risk: a bottom-pinned toast could otherwise land on
          top of a footer that's pushed below the fold on a long form). */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'nl-modal-animate relative z-10 mt-8 flex max-h-[calc(100dvh-4rem)] w-full flex-col rounded-xl bg-surface shadow-modal outline-none',
          'border border-ink-200',
          size,
        )}
      >
        {title !== undefined && (
          <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-5 py-3.5">
            <h2
              id={titleId}
              className="font-display text-sm font-semibold tracking-[-0.01em] text-ink-900"
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded p-1.5 text-ink-400 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-ink-100 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
