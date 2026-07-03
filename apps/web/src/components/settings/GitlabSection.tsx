/**
 * GitlabSection
 *
 * Project Settings "GitLab" card — mirrors `GithubSection.tsx` exactly,
 * GitLab semantics: a "namespace/project" path (which may include nested
 * subgroups) instead of a flat "owner/repo", plus an optional self-hosted
 * instance URL (self-hosted GitLab is a first-class target for Next Lane's
 * self-hosted audience, not an afterthought).
 *
 * ADMIN: a form to link a GitLab project (namespace/project + optional
 * instance URL + a PAT) and, once configured, the generated inbound webhook
 * URL + secret ("Secret Token" in GitLab's webhook UI) with copy-to-
 * clipboard and paste-into-GitLab instructions. Re-saving requires the PAT
 * again (Next Lane never displays a saved token back — write-only, matching
 * the PAT/webhook-secret pattern used elsewhere in Settings).
 *
 * MEMBER/VIEWER: a compact read-only summary ("Connected to namespace/project"),
 * hidden entirely when nothing is configured yet.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import {
  useGitlabIntegration,
  useUpsertGitlabIntegration,
  useDeleteGitlabIntegration,
} from '@/api/gitlab';

/** Card wrapper matching the other Settings section cards. */
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
    <section
      className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
      data-testid="gitlab-section"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-ink-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CopyField({
  label,
  value,
  testId,
  mono = true,
}: {
  label: string;
  value: string;
  testId: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid={testId}
          className={cn(
            'min-w-0 flex-1 break-all rounded border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-xs text-ink-800',
            mono && 'font-mono',
          )}
        >
          {value}
        </code>
        <Button size="sm" variant="secondary" onClick={copy} className="shrink-0">
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function GitlabSection({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const integrationQuery = useGitlabIntegration(projectId);
  const upsert = useUpsertGitlabIntegration(projectId);
  const remove = useDeleteGitlabIntegration(projectId);
  const toast = useToast();

  const [projectPath, setProjectPath] = useState('');
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const integration = integrationQuery.data ?? null;

  if (!isAdmin) {
    // Read-only summary for members — hidden when nothing is configured.
    if (!integration) return null;
    return (
      <SectionCard title="GitLab" description="Linked GitLab project for this project.">
        <p className="text-sm text-ink-600" data-testid="gitlab-connected-summary">
          Connected to{' '}
          <span className="font-medium text-ink-900">{integration.projectPath}</span>
        </p>
      </SectionCard>
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const path = projectPath.trim() || integration?.projectPath.trim() || '';
    if (!path || !token.trim()) return;
    upsert.mutate(
      {
        projectPath: path,
        gitlabBaseUrl: gitlabBaseUrl.trim() || undefined,
        token: token.trim(),
      },
      {
        onSuccess: () => {
          toast.success('GitLab integration saved.');
          setToken('');
          setProjectPath('');
          setGitlabBaseUrl('');
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not save the GitLab integration.')),
      },
    );
  }

  function confirmRemove() {
    remove.mutate(undefined, {
      onSuccess: () => toast.success('GitLab integration disconnected.'),
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not disconnect GitLab.')),
      onSettled: () => setConfirmDelete(false),
    });
  }

  return (
    <SectionCard
      title="GitLab"
      description="Link a GitLab project (SaaS or self-hosted) so merge requests, commits, and branches referencing an issue key (e.g. NL-123) show up on that issue automatically."
      action={
        integration && (
          <Button
            size="sm"
            variant="secondary"
            className="text-red-600 hover:bg-red-50"
            onClick={() => setConfirmDelete(true)}
            data-testid="gitlab-delete"
          >
            Disconnect
          </Button>
        )
      }
    >
      {integrationQuery.isLoading ? (
        <p className="py-4 text-sm text-ink-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          {integration && (
            <p className="text-sm text-ink-600">
              Connected to{' '}
              <span className="font-medium text-ink-900">{integration.projectPath}</span>
              {' on '}
              <span className="font-mono text-xs text-ink-500">{integration.gitlabBaseUrl}</span>
            </p>
          )}

          <form onSubmit={handleSave} className="space-y-3">
            <Field
              label="Project path"
              htmlFor="gitlab-project-path-input"
              hint='"namespace/project" — may include nested subgroups, e.g. "acme/team/widgets".'
            >
              <Input
                id="gitlab-project-path-input"
                data-testid="gitlab-project-path-input"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder={integration?.projectPath || 'namespace/project'}
                autoComplete="off"
              />
            </Field>
            <Field
              label="GitLab instance URL"
              htmlFor="gitlab-base-url-input"
              hint='Optional — defaults to "https://gitlab.com". Set this for a self-hosted GitLab instance.'
            >
              <Input
                id="gitlab-base-url-input"
                data-testid="gitlab-base-url-input"
                value={gitlabBaseUrl}
                onChange={(e) => setGitlabBaseUrl(e.target.value)}
                placeholder={integration?.gitlabBaseUrl || 'https://gitlab.com'}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Personal access token"
              htmlFor="gitlab-token-input"
              hint={
                integration
                  ? 'Never shown after saving — re-enter it to rotate or to update the project.'
                  : 'A GitLab PAT with "api" or "read_api" scope. Stored encrypted; never displayed again.'
              }
            >
              <Input
                id="gitlab-token-input"
                data-testid="gitlab-token-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="glpat-…"
                autoComplete="off"
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              loading={upsert.isPending}
              disabled={!token.trim() || (!projectPath.trim() && !integration)}
              data-testid="gitlab-save"
            >
              {integration ? 'Save changes' : 'Connect project'}
            </Button>
          </form>

          {integration && (
            <div className="space-y-4 rounded-lg border border-ink-100 bg-ink-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                Webhook setup
              </p>
              <p className="text-xs text-ink-500">
                In your GitLab project, go to{' '}
                <strong>Settings → Webhooks</strong>. Paste the URL and secret token below,
                and select the <strong>Push events</strong> and{' '}
                <strong>Merge request events</strong> triggers.
              </p>
              <CopyField label="URL" value={integration.webhookUrl} testId="gitlab-webhook-url" />
              {integration.webhookSecret && (
                <CopyField label="Secret Token" value={integration.webhookSecret} testId="gitlab-webhook-secret" />
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Disconnect GitLab"
        message="Disconnect this GitLab project? The webhook will stop linking new MRs/commits; issues that are already linked keep their history."
        confirmLabel="Disconnect"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={confirmRemove}
      />
    </SectionCard>
  );
}
