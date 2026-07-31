/**
 * PageTemplatesSection
 *
 * Settings section for doc (page) templates. ADMINs create/edit/delete;
 * everyone else sees the list read-only.
 *
 * Works for BOTH scopes from one component — a project's Settings passes
 * `{ kind: 'project' }` and workspace Settings passes `{ kind: 'workspace' }`.
 * In a project it lists only the project's OWN templates (`ownedOnly`), so
 * Delete is never offered for an inherited workspace row this screen can't
 * legitimately remove; a hint points at workspace settings for those.
 *
 * Mirrors TemplatesManager.tsx patterns: modal CRUD, ConfirmDialog, toast,
 * errorMessage.
 */
import { useState, type FormEvent } from 'react';
import {
  PAGE_TEMPLATE_TOKENS,
  usedPageTemplateTokens,
  type PageTemplateDto,
} from '@next-lane/shared';
import {
  usePageTemplates,
  useCreatePageTemplate,
  useUpdatePageTemplate,
  useDeletePageTemplate,
} from '@/api/pageTemplates';
import type { PagesScope } from '@/api/keys';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

export interface PageTemplatesSectionProps {
  scope: PagesScope;
  /** ADMIN in this scope — gates every write affordance. */
  canManage: boolean;
}

interface DraftState {
  id: string | null;
  name: string;
  description: string;
  titleTemplate: string;
  content: string;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  name: '',
  description: '',
  titleTemplate: '',
  content: '',
};

export function PageTemplatesSection({ scope, canManage }: PageTemplatesSectionProps) {
  const toast = useToast();
  // In a project, manage only what the project owns — inherited workspace rows
  // are shown by the picker but are not this screen's to edit or delete.
  const query = usePageTemplates(scope, { ownedOnly: scope.kind === 'project' });
  const createMut = useCreatePageTemplate(scope);
  const updateMut = useUpdatePageTemplate(scope);
  const deleteMut = useDeletePageTemplate(scope);

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PageTemplateDto | null>(null);

  const templates = query.data ?? [];
  const tokenReport = draft ? usedPageTemplateTokens(`${draft.titleTemplate}\n${draft.content}`) : null;

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT });
  }

  function openEdit(t: PageTemplateDto) {
    setDraft({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      titleTemplate: t.titleTemplate ?? '',
      content: t.content,
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft || !draft.name.trim()) return;
    const payload = {
      name: draft.name.trim(),
      // Empty string means "cleared", which the API models as null.
      description: draft.description.trim() || null,
      titleTemplate: draft.titleTemplate.trim() || null,
      content: draft.content,
    };
    const onDone = {
      onSuccess: () => {
        toast.success(draft.id ? 'Template updated.' : 'Template created.');
        setDraft(null);
      },
      onError: (err: unknown) =>
        toast.error(errorMessage(err, 'Could not save the template.')),
    };
    if (draft.id) updateMut.mutate({ id: draft.id, ...payload }, onDone);
    else createMut.mutate(payload, onDone);
  }

  function doDelete() {
    if (!confirmDelete) return;
    deleteMut.mutate(confirmDelete.id, {
      onSuccess: () => {
        toast.success('Template deleted.');
        setConfirmDelete(null);
      },
      onError: (err) => toast.error(errorMessage(err, 'Could not delete the template.')),
    });
  }

  if (query.isLoading) return <LoadingState label="Loading templates…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <section data-testid="page-templates-section">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Doc templates</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {scope.kind === 'workspace'
              ? 'Available when creating a page anywhere in this workspace.'
              : 'Available in this project, alongside the workspace’s shared templates.'}
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate} data-testid="page-template-new">
            New template
          </Button>
        )}
      </div>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-200 px-6 py-10 text-center">
          <h3 className="text-sm font-medium text-ink-900">No doc templates yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
            {scope.kind === 'project'
              ? 'This project has none of its own. Pages here can still use the workspace’s shared templates.'
              : 'Create one to give every new page a consistent starting structure.'}
          </p>
          {canManage && (
            <Button className="mt-4" variant="secondary" onClick={openCreate}>
              New template
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-start justify-between gap-4 px-4 py-3"
              data-testid="page-template-row"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink-900">{t.name}</span>
                  {t.builtIn && <Badge>Built-in</Badge>}
                </div>
                {t.description && (
                  <p className="mt-0.5 truncate text-sm text-ink-500">{t.description}</p>
                )}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEdit(t)}
                    aria-label={`Edit ${t.name}`}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(t)}
                    aria-label={`Delete ${t.name}`}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit doc template' : 'New doc template'}
        size="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={createMut.isPending || updateMut.isPending}
              disabled={!draft?.name.trim()}
              data-testid="page-template-save"
            >
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Name" htmlFor="pt-name">
              <Input
                id="pt-name"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Meeting notes"
                data-testid="page-template-name"
              />
            </Field>

            <Field label="Description" htmlFor="pt-description" hint="Shown under the name in the picker.">
              <Input
                id="pt-description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Agenda, decisions and action items."
              />
            </Field>

            <Field
              label="Default title"
              htmlFor="pt-title"
              hint="Pre-fills the title field. Leave blank to always type one."
            >
              <Input
                id="pt-title"
                value={draft.titleTemplate}
                onChange={(e) => setDraft({ ...draft, titleTemplate: e.target.value })}
                placeholder="Meeting notes — {{date}}"
                data-testid="page-template-title-template"
              />
            </Field>

            <Field label="Content" htmlFor="pt-content">
              <Textarea
                id="pt-content"
                rows={14}
                className="font-mono text-xs"
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder={'# {{title}}\n\n## Notes\n'}
                data-testid="page-template-content"
              />
            </Field>

            <div className="rounded-md bg-ink-50 px-3 py-2">
              <p className="text-xs font-medium text-ink-700">Placeholders</p>
              <p className="mt-1 text-xs text-ink-500">
                {PAGE_TEMPLATE_TOKENS.map((t) => `{{${t.token}}}`).join(' · ')}
              </p>
              {/* Warn BEFORE the template ships into every page made from it —
                  an unknown token renders as literal braces, by design. */}
              {tokenReport && tokenReport.unknown.length > 0 && (
                <p className="mt-1.5 text-xs text-amber-700" data-testid="page-template-unknown-tokens">
                  Not a known placeholder:{' '}
                  {tokenReport.unknown.map((u) => `{{${u}}}`).join(', ')} — it will appear
                  as-is in the page.
                </p>
              )}
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete template?"
        message={
          confirmDelete
            ? `"${confirmDelete.name}" will be removed. Pages already created from it are not affected.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMut.isPending}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}
