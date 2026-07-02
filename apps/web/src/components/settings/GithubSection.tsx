/**
 * GithubSection
 *
 * Project Settings "GitHub" card — Phase 9 Developer Graph v1 kickoff.
 *
 * ADMIN: a form to link a GitHub repo (owner/repo + a PAT) and, once
 * configured, the generated inbound webhook URL + secret with copy-to-
 * clipboard and paste-into-GitHub instructions. Re-saving requires the PAT
 * again (Next Lane never displays a saved token back — write-only, matching
 * the PAT/webhook-secret pattern used elsewhere in Settings).
 *
 * MEMBER/VIEWER: a compact read-only summary ("Connected to owner/repo"),
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
  useGithubIntegration,
  useUpsertGithubIntegration,
  useDeleteGithubIntegration,
} from '@/api/github';

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
      className="rounded-xl border border-ink-200 bg-white p-4 shadow-card sm:p-5"
      data-testid="github-section"
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

export function GithubSection({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const integrationQuery = useGithubIntegration(projectId);
  const upsert = useUpsertGithubIntegration(projectId);
  const remove = useDeleteGithubIntegration(projectId);
  const toast = useToast();

  const [repoFullName, setRepoFullName] = useState('');
  const [token, setToken] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const integration = integrationQuery.data ?? null;

  if (!isAdmin) {
    // Read-only summary for members — hidden when nothing is configured.
    if (!integration) return null;
    return (
      <SectionCard title="GitHub" description="Linked repository for this project.">
        <p className="text-sm text-ink-600" data-testid="github-connected-summary">
          Connected to{' '}
          <span className="font-medium text-ink-900">{integration.repoFullName}</span>
        </p>
      </SectionCard>
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const repo = repoFullName.trim() || integration?.repoFullName.trim() || '';
    if (!repo || !token.trim()) return;
    upsert.mutate(
      { repoFullName: repo, token: token.trim() },
      {
        onSuccess: () => {
          toast.success('GitHub integration saved.');
          setToken('');
          setRepoFullName('');
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not save the GitHub integration.')),
      },
    );
  }

  function confirmRemove() {
    remove.mutate(undefined, {
      onSuccess: () => toast.success('GitHub integration disconnected.'),
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not disconnect GitHub.')),
      onSettled: () => setConfirmDelete(false),
    });
  }

  return (
    <SectionCard
      title="GitHub"
      description="Link a repository so pull requests, commits, and branches referencing an issue key (e.g. NL-123) show up on that issue automatically."
      action={
        integration && (
          <Button
            size="sm"
            variant="secondary"
            className="text-red-600 hover:bg-red-50"
            onClick={() => setConfirmDelete(true)}
            data-testid="github-delete"
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
            </p>
          )}

          <form onSubmit={handleSave} className="space-y-3">
            <Field label="Repository" htmlFor="github-repo-input" hint='Format: "owner/repo", e.g. "acme/widgets".'>
              <Input
                id="github-repo-input"
                data-testid="github-repo-input"
                value={repoFullName}
                onChange={(e) => setRepoFullName(e.target.value)}
                placeholder={integration?.repoFullName || 'owner/repo'}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Personal access token"
              htmlFor="github-token-input"
              hint={
                integration
                  ? 'Never shown after saving — re-enter it to rotate or to update the repository.'
                  : 'A GitHub PAT with repo read access. Stored encrypted; never displayed again.'
              }
            >
              <Input
                id="github-token-input"
                data-testid="github-token-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_…"
                autoComplete="off"
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              loading={upsert.isPending}
              disabled={!token.trim() || (!repoFullName.trim() && !integration)}
              data-testid="github-save"
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
                In your GitHub repo, go to <strong>Settings → Webhooks → Add webhook</strong>.
                Paste the URL and secret below, set content type to{' '}
                <code className="rounded bg-white px-1 py-0.5 font-mono">application/json</code>,
                and select the <strong>Pushes</strong> and <strong>Pull requests</strong> events.
              </p>
              <CopyField label="Payload URL" value={integration.webhookUrl} testId="github-webhook-url" />
              {integration.webhookSecret && (
                <CopyField label="Secret" value={integration.webhookSecret} testId="github-webhook-secret" />
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Disconnect GitHub"
        message="Disconnect this repository? The webhook will stop linking new PRs/commits; issues that are already linked keep their history."
        confirmLabel="Disconnect"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={confirmRemove}
      />
    </SectionCard>
  );
}
