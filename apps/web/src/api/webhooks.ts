import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WebhookDeliveryDto,
  WebhookEventType,
  WebhookSubscriptionDto,
} from '@next-lane/shared';
import { request } from './client';

/** Query keys for the webhook subscription list and per-subscription deliveries. */
export const webhookKeys = {
  list: (projectId: string) => ['webhooks', projectId] as const,
  deliveries: (projectId: string, subscriptionId: string) =>
    ['webhookDeliveries', projectId, subscriptionId] as const,
};

export interface WebhookInput {
  url: string;
  secret?: string;
  events?: WebhookEventType[];
  active?: boolean;
}

/** List a project's webhook subscriptions (ADMIN-only on the server). */
export function useWebhooks(projectId: string, enabled = true) {
  return useQuery({
    queryKey: webhookKeys.list(projectId),
    queryFn: () =>
      request<WebhookSubscriptionDto[]>(`/projects/${projectId}/webhooks`),
    enabled: enabled && !!projectId,
  });
}

/** Recent delivery log for a single subscription. */
export function useWebhookDeliveries(
  projectId: string,
  subscriptionId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: webhookKeys.deliveries(projectId, subscriptionId),
    queryFn: () =>
      request<WebhookDeliveryDto[]>(
        `/projects/${projectId}/webhooks/${subscriptionId}/deliveries`,
      ),
    enabled: enabled && !!projectId && !!subscriptionId,
  });
}

export function useCreateWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WebhookInput) =>
      request<WebhookSubscriptionDto>(`/projects/${projectId}/webhooks`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: webhookKeys.list(projectId) });
    },
  });
}

export function useUpdateWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: WebhookInput & { id: string }) =>
      request<WebhookSubscriptionDto>(
        `/projects/${projectId}/webhooks/${id}`,
        { method: 'PATCH', body: input },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: webhookKeys.list(projectId) });
    },
  });
}

export function useDeleteWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/projects/${projectId}/webhooks/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: webhookKeys.list(projectId) });
    },
  });
}

/** Fire a sample event at a subscription so the admin can verify wiring. */
export function useTestWebhook(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ ok: true }>(`/projects/${projectId}/webhooks/${id}/test`, {
        method: 'POST',
      }),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({
        queryKey: webhookKeys.deliveries(projectId, id),
      });
    },
  });
}
