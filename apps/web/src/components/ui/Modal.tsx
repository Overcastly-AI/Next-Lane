import { useRef, type ReactNode } from 'react';
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

  useOverlay({ open, onClose, containerRef: panelRef });

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role={role}
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative z-10 mt-8 w-full rounded-xl bg-white shadow-xl outline-none',
          size,
        )}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
