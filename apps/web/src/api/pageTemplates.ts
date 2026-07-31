import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePageFromTemplateDto,
  CreatePageTemplateDto,
  PageDto,
  PageTemplateDto,
  UpdatePageTemplateDto,
} from '@next-lane/shared';
import { request } from './client';
import { qk, invalidatePagesFamily, type PagesScope } from './keys';

/** The REST collection path for a scope's templates. */
function collectionPath(scope: PagesScope): string {
  return scope.kind === 'project'
    ? `/projects/${scope.id}/page-templates`
    : `/workspaces/${scope.id}/page-templates`;
}

/**
 * Templates available in a scope.
 *
 * For a PROJECT scope the server merges in the workspace-wide templates the
 * project inherits (project rows first). Pass `ownedOnly` on the management
 * screen so "delete" is never offered for a row this scope doesn't own.
 */
export function usePageTemplates(
  scope: PagesScope | undefined,
  opts?: { ownedOnly?: boolean; enabled?: boolean },
) {
  const ownedOnly = opts?.ownedOnly ?? false;
  return useQuery({
    queryKey: scope
      ? ([...qk.pageTemplates(scope), { ownedOnly }] as const)
      : ['pageTemplates', 'none'],
    queryFn: () => {
      if (!scope) return Promise.resolve<PageTemplateDto[]>([]);
      const q =
        scope.kind === 'project' && ownedOnly ? '?includeInherited=false' : '';
      return request<PageTemplateDto[]>(`${collectionPath(scope)}${q}`);
    },
    enabled: Boolean(scope) && (opts?.enabled ?? true),
  });
}

export function useCreatePageTemplate(scope: PagesScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePageTemplateDto) =>
      request<PageTemplateDto>(collectionPath(scope), {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => invalidateTemplates(qc, scope),
  });
}

export function useUpdatePageTemplate(scope: PagesScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: UpdatePageTemplateDto & { id: string }) =>
      request<PageTemplateDto>(`/page-templates/${id}`, {
        method: 'PATCH',
        body: dto,
      }),
    onSuccess: () => invalidateTemplates(qc, scope),
  });
}

export function useDeletePageTemplate(scope: PagesScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/page-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTemplates(qc, scope),
  });
}

/**
 * Create a real page from a template.
 *
 * Invalidates the PAGES family (not the template list) — the mutation's
 * product is a page; the template is unchanged.
 */
export function useCreatePageFromTemplate(scope: PagesScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      ...dto
    }: CreatePageFromTemplateDto & { templateId: string }) =>
      request<PageDto>(`/page-templates/${templateId}/create-page`, {
        method: 'POST',
        body: dto,
      }),
    onSuccess: () => invalidatePagesFamily(qc, scope),
  });
}

/**
 * Invalidate a scope's template list.
 *
 * A WORKSPACE-scope write must also clear every project list, because those
 * lists embed the inherited workspace rows — otherwise editing a workspace
 * template leaves a stale copy showing in each project's picker. A broad
 * prefix invalidation on `['projectPageTemplates']` is the same pragmatic
 * tradeoff `invalidatePagesFamily` already makes for `['pageBacklinks']`.
 */
function invalidateTemplates(
  qc: ReturnType<typeof useQueryClient>,
  scope: PagesScope,
): void {
  void qc.invalidateQueries({ queryKey: qk.pageTemplates(scope) });
  if (scope.kind === 'workspace') {
    void qc.invalidateQueries({ queryKey: ['projectPageTemplates'] });
  }
}
