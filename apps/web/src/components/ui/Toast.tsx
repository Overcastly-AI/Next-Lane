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
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  /** Optional bold lead-in shown before the message. */
  title?: string;
  /** Auto-dismiss delay in ms. Defaults to 4000 (6000 for errors). */
  duration?: number;
}

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  title?: string;
  duration: number;
}

export interface ToastApi {
  toast: (variant: ToastVariant, message: string, options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;
const ERROR_DURATION = 6000;

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (variant: ToastVariant, message: string, options?: ToastOptions) => {
      const id = nextId++;
      const duration =
        options?.duration ??
        (variant === 'error' ? ERROR_DURATION : DEFAULT_DURATION);
      setToasts((prev) => [
        ...prev,
        { id, variant, message, title: options?.title, duration },
      ]);
      const handle = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, handle);
    },
    [dismiss],
  );

  // Clear any pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (message, options) => toast('success', message, options),
      error: (message, options) => toast('error', message, options),
      info: (message, options) => toast('info', message, options),
      dismiss,
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>.');
  }
  return ctx;
}

const variantStyles: Record<
  ToastVariant,
  { container: string; icon: ReactNode; iconColor: string }
> = {
  success: {
    container: 'border-green-200 bg-green-50',
    iconColor: 'text-green-600',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    ),
  },
  error: {
    container: 'border-red-200 bg-red-50',
    iconColor: 'text-red-600',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
    ),
  },
  info: {
    container: 'border-brand-200 bg-brand-50',
    iconColor: 'text-brand-600',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z"
      />
    ),
  },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-0 sm:right-0 sm:left-auto sm:top-auto sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const style = variantStyles[toast.variant];
  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      data-toast
      data-variant={toast.variant}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-cardHover',
        'animate-[nl-toast-in_160ms_ease-out]',
        style.container,
      )}
    >
      <svg
        className={cn('mt-0.5 h-5 w-5 flex-shrink-0', style.iconColor)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        {style.icon}
      </svg>
      <div className="min-w-0 flex-1 text-sm">
        {toast.title && (
          <p className="font-semibold text-gray-900">{toast.title}</p>
        )}
        <p className="text-gray-700">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 rounded-md p-1 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-600"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>
    </div>
  );
}
