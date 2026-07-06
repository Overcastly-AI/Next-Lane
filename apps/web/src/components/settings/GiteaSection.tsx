/**
 * GiteaSection
 *
 * Project Settings "Gitea" card — mirrors `GithubSection.tsx`/`GitlabSection.tsx`,
 * third self-hosted-forge semantics: a REQUIRED self-hosted instance URL (Gitea
 * has no canonical SaaS host to default to, unlike GitLab's gitlab.com) plus a
 * flat "owner/repo" path (like GitHub's, not GitLab's nested-subgroup path).
 *
 * ADMIN: a form to link a Gitea repository (instance URL + owner/repo + an
 * access token) and, once configured, the generated inbound webhook URL +
 * HMAC secret with copy-to-clipboard and paste-into-Gitea instructions.
 * Re-saving requires the token again (Next Lane never displays a saved token
 * back — write-only, matching the PAT/webhook-secret pattern used elsewhere
 * in Settings).
 *
 * MEMBER/VIEWER: a compact read-only summary ("Connected to owner/repo"),
 * hidden entirely when nothing is configured yet.
 *
 * v1 deliberately has NO auto-transition-on-merge toggle (unlike
 * `GithubSection`/`GitlabSection`) — links only, no automation in this pass.
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
  useGiteaIntegration,
  useUpsertGiteaIntegration,
  useDeleteGiteaIntegration,
} from '@/api/gitea';

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
      data-testid="gitea-section"
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

export function GiteaSection({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const integrationQuery = useGiteaIntegration(projectId);
  const upsert = useUpsertGiteaIntegration(projectId);
  const remove = useDeleteGiteaIntegration(projectId);
  const toast = useToast();

  const [giteaBaseUrl, setGiteaBaseUrl] = useState('');
  const [repoFullName, setRepoFullName] = useState('');
  const [token, setToken] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const integration = integrationQuery.data ?? null;

  if (!isAdmin) {
    // Read-only summary for members — hidden when nothing is configured.
    if (!integration) return null;
    return (
      <SectionCard title="Gitea" description="Linked Gitea repository for this project.">
        <p className="text-sm text-ink-600" data-testid="gitea-connected-summary">
          Connected to{' '}
          <span className="font-medium text-ink-900">{integration.repoFullName}</span>
          {' on '}
          <span className="font-mono text-xs text-ink-500">{integration.giteaBaseUrl}</span>
        </p>
      </SectionCard>
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const base = giteaBaseUrl.trim() || integration?.giteaBaseUrl.trim() || '';
    const repo = repoFullName.trim() || integration?.repoFullName.trim() || '';
    if (!base || !repo || !token.trim()) return;
    upsert.mutate(
      {
        giteaBaseUrl: base,
        repoFullName: repo,
        token: token.trim(),
      },
      {
        onSuccess: () => {
          toast.success('Gitea integration saved.');
          setToken('');
          setGiteaBaseUrl('');
          setRepoFullName('');
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not save the Gitea integration.')),
      },
    );
  }

  function confirmRemove() {
    remove.mutate(undefined, {
      onSuccess: () => toast.success('Gitea integration disconnected.'),
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not disconnect Gitea.')),
      onSettled: () => setConfirmDelete(false),
    });
  }

  return (
    <SectionCard
      title="Gitea"
      description="Link a self-hosted Gitea repository so pull requests, commits, and branches referencing an issue key (e.g. NL-123) show up on that issue automatically."
      action={
        integration && (
          <Button
            size="sm"
            variant="secondary"
            className="text-red-600 hover:bg-red-50"
            onClick={() => setConfirmDelete(true)}
            data-testid="gitea-delete"
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
              <span className="font-medium text-ink-900">{integration.repoFullName}</span>
              {' on '}
              <span className="font-mono text-xs text-ink-500">{integration.giteaBaseUrl}</span>
            </p>
          )}

          <form onSubmit={handleSave} className="space-y-3">
            <Field
              label="Gitea instance URL"
              htmlFor="gitea-base-url-input"
              hint="Your self-hosted Gitea instance's URL, e.g. https://git.example.com. Required — Gitea has no shared SaaS host."
            >
              <Input
                id="gitea-base-url-input"
                data-testid="gitea-base-url-input"
                value={giteaBaseUrl}
                onChange={(e) => setGiteaBaseUrl(e.target.value)}
                placeholder={integration?.giteaBaseUrl || 'https://git.example.com'}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Repository"
              htmlFor="gitea-repo-input"
              hint='"owner/repo" format, e.g. "acme/widgets".'
            >
              <Input
                id="gitea-repo-input"
                data-testid="gitea-repo-input"
                value={repoFullName}
                onChange={(e) => setRepoFullName(e.target.value)}
                placeholder={integration?.repoFullName || 'owner/repo'}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Access token"
              htmlFor="gitea-token-input"
              hint={
                integration
                  ? 'Never shown after saving — re-enter it to rotate or to update the repository.'
                  : 'A Gitea access token with repo read scope. Stored encrypted; never displayed again.'
              }
            >
              <Input
                id="gitea-token-input"
                data-testid="gitea-token-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="•••••••••••"
                autoComplete="off"
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              loading={upsert.isPending}
              disabled={
                !token.trim() ||
                (!repoFullName.trim() && !integration) ||
                (!giteaBaseUrl.trim() && !integration)
              }
              data-testid="gitea-save"
            >
              {integration ? 'Save changes' : 'Connect repository'}
            </Button>
          </form>

          {integration && (
            <div className="space-y-4 rounded-lg border border-ink-100 bg-ink-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                Webhook setup
              </p>
              <p className="text-xs text-ink-500">
                In your Gitea repository, go to{' '}
                <strong>Settings → Webhooks → Add Webhook → Gitea</strong>. Paste the URL
                and secret below, and select the <strong>Push events</strong> and{' '}
                <strong>Pull Request events</strong> triggers.
              </p>
              <CopyField label="URL" value={integration.webhookUrl} testId="gitea-webhook-url" />
              {integration.webhookSecret && (
                <CopyField label="Secret" value={integration.webhookSecret} testId="gitea-webhook-secret" />
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Disconnect Gitea"
        message="Disconnect this Gitea repository? The webhook will stop linking new PRs/commits; issues that are already linked keep their history."
        confirmLabel="Disconnect"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={confirmRemove}
      />
    </SectionCard>
  );
}
