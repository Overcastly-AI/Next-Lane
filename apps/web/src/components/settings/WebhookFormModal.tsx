import { useEffect, useState, type FormEvent } from 'react';
import {
  WEBHOOK_EVENT_TYPES,
  type WebhookEventType,
  type WebhookSubscriptionDto,
} from '@next-lane/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { useCreateWebhook, useUpdateWebhook } from '@/api/webhooks';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

/** Friendly labels for each subscribable event type. */
const EVENT_LABEL: Record<WebhookEventType, string> = {
  'issue.created': 'Issue created',
  'issue.updated': 'Issue updated',
  'issue.moved': 'Issue moved',
  'issue.deleted': 'Issue deleted',
  'comment.created': 'Comment added',
  'sprint.started': 'Sprint started',
  'sprint.completed': 'Sprint completed',
};

/**
 * Add or edit a webhook subscription. When `webhook` is provided the form edits
 * that endpoint; otherwise it creates a new one. An empty event selection means
 * "all events". The signing secret is write-only — it is never returned by the
 * API, so on edit the field is left blank and only sent if the admin types a new
 * one.
 */
export function WebhookFormModal({
  open,
  onClose,
  projectId,
  webhook,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  webhook?: WebhookSubscriptionDto;
}) {
  const isEdit = !!webhook;
  const create = useCreateWebhook(projectId);
  const update = useUpdateWebhook(projectId);
  const toast = useToast();

  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl(webhook?.url ?? '');
    setSecret('');
    setEvents(webhook?.events ?? []);
    setActive(webhook?.active ?? true);
    setError(null);
  }, [open, webhook]);

  const pending = create.isPending || update.isPending;

  function toggleEvent(event: WebhookEventType) {
    setEvents((prev) =>
      prev.includes(event)
        ? prev.filter((e) => e !== event)
        : [...prev, event],
    );
  }

  function handleClose() {
    setError(null);
    onClose();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    setError(null);
    const trimmedSecret = secret.trim();
    try {
      if (isEdit && webhook) {
        await update.mutateAsync({
          id: webhook.id,
          url: trimmedUrl,
          events,
          active,
          // Only send the secret when the admin entered a replacement.
          ...(trimmedSecret ? { secret: trimmedSecret } : {}),
        });
        toast.success('Webhook updated.');
      } else {
        await create.mutateAsync({
          url: trimmedUrl,
          events,
          active,
          ...(trimmedSecret ? { secret: trimmedSecret } : {}),
        });
        toast.success('Webhook created.');
      }
      handleClose();
    } catch (err) {
      const message = errorMessage(
        err,
        isEdit ? 'Could not update the webhook.' : 'Could not create the webhook.',
      );
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? 'Edit webhook' : 'Add webhook'}
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="webhook-form"
            loading={pending}
            disabled={!url.trim()}
          >
            {isEdit ? 'Save' : 'Add webhook'}
          </Button>
        </>
      }
    >
      <form id="webhook-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Payload URL" htmlFor="webhook-url">
          <Input
            id="webhook-url"
            type="url"
            autoFocus
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhooks/next-lane"
          />
        </Field>

        <Field
          label="Signing secret"
          htmlFor="webhook-secret"
          hint={
            isEdit
              ? 'Leave blank to keep the current secret. Used to sign the X-NextLane-Signature header.'
              : 'Optional. Used to sign the X-NextLane-Signature header (HMAC-SHA256). A random secret is generated if left blank.'
          }
        >
          <Input
            id="webhook-secret"
            type="text"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={isEdit ? '••••••••  (unchanged)' : 'auto-generated'}
            minLength={8}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">
            Events
          </legend>
          <p className="text-xs text-slate-500">
            Select which events trigger this webhook. Leave all unchecked to
            receive every event.
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {WEBHOOK_EVENT_TYPES.map((event) => (
              <label
                key={event}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                  checked={events.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
                {EVENT_LABEL[event]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active (deliver events to this endpoint)
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
