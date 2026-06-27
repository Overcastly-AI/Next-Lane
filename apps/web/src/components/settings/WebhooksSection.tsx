import { useState } from 'react';
import type { WebhookSubscriptionDto } from '@next-lane/shared';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import {
  useWebhooks,
  useWebhookDeliveries,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhook,
} from '@/api/webhooks';
import { WebhookFormModal } from './WebhookFormModal';

/** Card wrapper mirroring the Settings page section style. */
function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-gray-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Webhooks settings section: lists a project's registered webhook endpoints with
 * an active toggle, add/edit/delete, an expandable recent-delivery log, and a
 * "Send test" button. ADMIN-only — the section is not rendered for non-admins
 * (the server also enforces ADMIN on every endpoint).
 */
export function WebhooksSection({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const webhooksQuery = useWebhooks(projectId, isAdmin);
  const [formState, setFormState] = useState<
    { mode: 'add' } | { mode: 'edit'; webhook: WebhookSubscriptionDto } | null
  >(null);
  const [pendingDelete, setPendingDelete] =
    useState<WebhookSubscriptionDto | null>(null);

  const deleteWebhook = useDeleteWebhook(projectId);
  const toast = useToast();

  // Only admins manage webhooks (secrets + outbound delivery are sensitive).
  if (!isAdmin) return null;

  const webhooks = webhooksQuery.data ?? [];

  function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteWebhook.mutate(target.id, {
      onSuccess: () => toast.success('Webhook deleted.'),
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not delete the webhook.')),
      onSettled: () => setPendingDelete(null),
    });
  }

  return (
    <SectionCard
      title="Webhooks"
      description="Send signed HTTP POSTs to your own services when issues and sprints change."
      action={
        <Button size="sm" onClick={() => setFormState({ mode: 'add' })}>
          + Add webhook
        </Button>
      }
    >
      {webhooksQuery.isLoading ? (
        <p className="py-4 text-sm text-gray-400">Loading webhooks…</p>
      ) : webhooks.length === 0 ? (
        <p className="py-2 text-sm text-gray-400">
          No webhooks yet. Add one to receive event notifications.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              projectId={projectId}
              webhook={webhook}
              onEdit={() => setFormState({ mode: 'edit', webhook })}
              onDelete={() => setPendingDelete(webhook)}
            />
          ))}
        </ul>
      )}

      {formState && (
        <WebhookFormModal
          open
          onClose={() => setFormState(null)}
          projectId={projectId}
          webhook={formState.mode === 'edit' ? formState.webhook : undefined}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete webhook"
        message={
          <>
            Delete the webhook for{' '}
            <span className="font-medium text-gray-900">
              {pendingDelete?.url}
            </span>
            ? It will stop receiving events immediately.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteWebhook.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </SectionCard>
  );
}

function WebhookRow({
  projectId,
  webhook,
  onEdit,
  onDelete,
}: {
  projectId: string;
  webhook: WebhookSubscriptionDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showDeliveries, setShowDeliveries] = useState(false);
  const update = useUpdateWebhook(projectId);
  const test = useTestWebhook(projectId);
  const toast = useToast();

  function toggleActive() {
    update.mutate(
      { id: webhook.id, url: webhook.url, active: !webhook.active },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update the webhook.')),
      },
    );
  }

  function sendTest() {
    test.mutate(webhook.id, {
      onSuccess: () => {
        toast.success('Test event sent.');
        setShowDeliveries(true);
      },
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not send the test event.')),
    });
  }

  const eventSummary =
    webhook.events.length === 0
      ? 'All events'
      : `${webhook.events.length} event${webhook.events.length === 1 ? '' : 's'}`;

  return (
    <li className="py-3" data-testid="settings-webhook-row">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            webhook.active ? 'bg-green-500' : 'bg-gray-300',
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-800">
            {webhook.url}
          </p>
          <p className="text-xs text-gray-500">
            {eventSummary}
            {!webhook.active && ' · inactive'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setShowDeliveries((v) => !v)}
            className="rounded px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            aria-expanded={showDeliveries}
          >
            {showDeliveries ? 'Hide log' : 'Deliveries'}
          </button>
          <Button
            size="sm"
            variant="secondary"
            onClick={sendTest}
            loading={test.isPending}
          >
            Send test
          </Button>
          <button
            type="button"
            role="switch"
            aria-checked={webhook.active}
            aria-label={
              webhook.active ? 'Deactivate webhook' : 'Activate webhook'
            }
            onClick={toggleActive}
            disabled={update.isPending}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50',
              webhook.active ? 'bg-green-500' : 'bg-gray-300',
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                webhook.active ? 'translate-x-4' : 'translate-x-0.5',
              )}
            />
          </button>
          <IconButton aria-label={`Edit webhook ${webhook.url}`} onClick={onEdit}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </IconButton>
          <IconButton
            aria-label={`Delete webhook ${webhook.url}`}
            danger
            onClick={onDelete}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
            </svg>
          </IconButton>
        </div>
      </div>

      {showDeliveries && (
        <DeliveryLog projectId={projectId} subscriptionId={webhook.id} />
      )}
    </li>
  );
}

function DeliveryLog({
  projectId,
  subscriptionId,
}: {
  projectId: string;
  subscriptionId: string;
}) {
  const deliveriesQuery = useWebhookDeliveries(projectId, subscriptionId);
  const deliveries = deliveriesQuery.data ?? [];

  return (
    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Recent deliveries
      </h3>
      {deliveriesQuery.isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : deliveries.length === 0 ? (
        <p className="text-xs text-gray-400">No deliveries yet.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="webhook-delivery-list">
          {deliveries.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 text-xs"
              data-testid="webhook-delivery-row"
            >
              <span
                className={cn(
                  'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium',
                  d.status === 'success'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700',
                )}
              >
                {d.status === 'success'
                  ? d.responseStatus ?? 'OK'
                  : 'Failed'}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-700">
                {d.event}
              </span>
              <span className="shrink-0 text-gray-400">
                {formatTime(d.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function IconButton({
  children,
  onClick,
  danger,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'rounded p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
        danger
          ? 'text-gray-400 hover:bg-red-50 hover:text-red-600'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}
