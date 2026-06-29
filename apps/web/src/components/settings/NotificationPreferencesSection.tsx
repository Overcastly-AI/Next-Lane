/**
 * Notification preferences — user-scoped email delivery opt-in.
 *
 * Next Lane always shows in-app notifications; this toggle controls whether the
 * same events (assignments, @mentions, comments, watched-issue updates) are
 * also delivered to the user's email. Persisted via PATCH /auth/me.
 *
 * Design: Dispatch system — ink neutrals, signal accent. Accessible switch
 * (role=switch + aria-checked), visible focus, optimistic-free (waits for the
 * server, shows a saving state, reverts is unnecessary since we send the result).
 */
import { useAuth } from '@/auth/AuthContext';
import { useUpdateProfile } from '@/api/me';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

export function NotificationPreferencesSection() {
  const { user } = useAuth();
  const update = useUpdateProfile();
  const { toast } = useToast();

  // The switch reflects the live user value; while a write is in flight we show
  // the pending target so it doesn't visually snap back.
  const enabled = update.isPending
    ? (update.variables?.emailNotifications ?? user?.emailNotifications ?? true)
    : (user?.emailNotifications ?? true);

  const onToggle = () => {
    if (update.isPending || !user) return;
    const next = !enabled;
    update.mutate(
      { emailNotifications: next },
      {
        onSuccess: () =>
          toast(
            'success',
            next ? 'Email notifications on' : 'Email notifications off',
          ),
        onError: (err) =>
          toast('error', errorMessage(err, 'Could not update preferences')),
      },
    );
  };

  return (
    <section
      data-testid="notification-preferences"
      className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-5"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink-900">Notifications</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          In-app notifications are always on. Control additional delivery below.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3.5 transition-colors duration-[120ms]">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={
            enabled
              ? 'Email notifications on — click to disable'
              : 'Email notifications off — click to enable'
          }
          data-testid="email-notifications-toggle"
          disabled={update.isPending || !user}
          onClick={onToggle}
          className={cn(
            'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
            'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1',
            enabled ? 'bg-signal-600' : 'bg-ink-300',
            (update.isPending || !user) && 'cursor-not-allowed opacity-60',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200',
              enabled ? 'translate-x-4' : 'translate-x-1',
            )}
          />
        </button>

        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-800">
            Email me about my issues
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            Assignments, @mentions, new comments, and updates to issues you
            watch. Sent to{' '}
            <span className="font-medium text-ink-700">
              {user?.email ?? 'your account email'}
            </span>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
