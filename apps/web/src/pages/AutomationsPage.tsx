/**
 * AutomationsPage — project automation rules management + run history.
 *
 * Route: /projects/:projectId/automations
 *
 * Layout: shell with AppHeader + ProjectNav, two tabs (Rules / Run Log).
 * The "Rules" tab lists all automation rules with enable/disable toggle,
 * edit, and delete. The "Run Log" tab renders AutomationRunsPanel.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGER_LABELS,
} from '@next-lane/shared';
import type { AutomationRuleDto } from '@next-lane/shared';
import { useProject } from '@/api/projects';
import { useStatuses, useLabels } from '@/api/meta';
import { useCustomFields } from '@/api/custom-fields';
import { useWorkspaceMembers } from '@/api/workspaces';
import { useSyncActiveWorkspace } from '@/contexts/WorkspaceContext';
import {
  useAutomations,
  useDeleteAutomation,
  useToggleAutomation,
} from '@/api/automations';
import { AppHeader } from '@/components/AppHeader';
import { ProjectNav } from '@/components/project/ProjectNav';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { AutomationRuleEditor } from '@/components/automation/AutomationRuleEditor';
import { AutomationRunsPanel } from '@/components/automation/AutomationRunsPanel';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function Shell({
  projectId,
  projectName,
  children,
}: {
  projectId: string;
  projectName: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="shrink-0 text-sm text-ink-400 hover:text-ink-600"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="min-w-0 truncate text-sm font-semibold text-ink-900">
            {projectName ?? 'Project'}
          </span>
        </div>
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enable/disable toggle
// ---------------------------------------------------------------------------

function EnableToggle({
  ruleId,
  projectId,
  enabled,
}: {
  ruleId: string;
  projectId: string;
  enabled: boolean;
}) {
  const toggle = useToggleAutomation(projectId);
  const toast = useToast();

  function handleClick() {
    toggle.mutate(
      { ruleId, enabled: !enabled },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not toggle the rule.')),
      },
    );
  }

  return (
    <button
      type="button"
      data-testid="automation-toggle"
      aria-label={enabled ? 'Disable rule' : 'Enable rule'}
      aria-pressed={enabled}
      onClick={handleClick}
      disabled={toggle.isPending}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1',
        enabled ? 'bg-signal-600' : 'bg-ink-200',
        'disabled:cursor-wait disabled:opacity-70',
      )}
    >
      <span className="sr-only">{enabled ? 'Disable' : 'Enable'}</span>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
          enabled ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Human summary of a rule's actions
// ---------------------------------------------------------------------------

function ActionSummary({ rule }: { rule: AutomationRuleDto }) {
  if (rule.actions.length === 0) {
    return <span className="text-ink-400 italic">No actions</span>;
  }
  const parts = rule.actions.map((a) => AUTOMATION_ACTION_LABELS[a.type]);
  return (
    <span className="text-xs text-ink-500">
      {parts.join(' · ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Rule list item
// ---------------------------------------------------------------------------

function RuleRow({
  rule,
  projectId,
  onEdit,
  onDelete,
}: {
  rule: AutomationRuleDto;
  projectId: string;
  onEdit: (rule: AutomationRuleDto) => void;
  onDelete: (rule: AutomationRuleDto) => void;
}) {
  return (
    <li
      data-testid="automation-row"
      className="flex flex-col gap-1 border-b border-ink-100 px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4"
    >
      {/* Toggle */}
      <div className="shrink-0">
        <EnableToggle ruleId={rule.id} projectId={projectId} enabled={rule.enabled} />
      </div>

      {/* Main info */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-ink-800">
            {rule.name}
          </span>
          {!rule.enabled && (
            <span className="inline-flex items-center rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold text-ink-500">
              Disabled
            </span>
          )}
        </div>

        {/* Trigger + condition summary */}
        <p className="text-xs text-ink-500">
          <span className="font-medium">{AUTOMATION_TRIGGER_LABELS[rule.trigger]}</span>
          {rule.condition && (
            <>
              {' '}
              &middot;{' '}
              <span className="font-mono text-[11px] text-ink-400">
                if {rule.condition}
              </span>
            </>
          )}
        </p>

        {/* Action summary */}
        <ActionSummary rule={rule} />

        {rule.description && (
          <p className="text-xs text-ink-400">{rule.description}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`Edit rule ${rule.name}`}
          onClick={() => onEdit(rule)}
          className="rounded p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="automation-delete"
          aria-label={`Delete rule ${rule.name}`}
          onClick={() => onDelete(rule)}
          className="rounded p-1.5 text-ink-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
          </svg>
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'rules' | 'runs';

export function AutomationsPage() {
  const { projectId = '' } = useParams();
  const [activeTab, setActiveTab] = useState<Tab>('rules');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRuleDto | undefined>();
  const [deletingRule, setDeletingRule] = useState<AutomationRuleDto | null>(null);

  const toast = useToast();

  // Project + supporting data queries
  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const automationsQuery = useAutomations(projectId);
  const statusesQuery = useStatuses(projectId);
  const labelsQuery = useLabels(projectId);
  const customFieldsQuery = useCustomFields(projectId);
  const membersQuery = useWorkspaceMembers(project?.workspaceId);
  useSyncActiveWorkspace(project?.workspaceId);
  const deleteRule = useDeleteAutomation(projectId);

  function openCreate() {
    setEditingRule(undefined);
    setEditorOpen(true);
  }

  function openEdit(rule: AutomationRuleDto) {
    setEditingRule(rule);
    setEditorOpen(true);
  }

  function handleDelete() {
    if (!deletingRule) return;
    const target = deletingRule;
    deleteRule.mutate(target.id, {
      onSuccess: () => {
        setDeletingRule(null);
        toast.success(`Deleted "${target.name}".`);
      },
      onError: (err) => {
        setDeletingRule(null);
        toast.error(errorMessage(err, 'Could not delete the rule.'));
      },
    });
  }

  const rules = automationsQuery.data ?? [];
  const statuses = statusesQuery.data ?? [];
  const labels = labelsQuery.data ?? [];
  const customFields = customFieldsQuery.data ?? [];
  const members = membersQuery.data ?? [];

  if (projectQuery.isLoading) {
    return (
      <Shell projectId={projectId} projectName={undefined}>
        <LoadingState label="Loading automations…" />
      </Shell>
    );
  }

  if (projectQuery.isError || !project) {
    return (
      <Shell projectId={projectId} projectName={undefined}>
        <ErrorState
          error={projectQuery.error ?? new Error('Project not found')}
          onRetry={() => void projectQuery.refetch()}
        />
      </Shell>
    );
  }

  return (
    <Shell projectId={projectId} projectName={project.name}>
      <div
        data-testid="automations-page"
        className="mx-auto flex w-full max-w-4xl flex-col gap-0 p-4 sm:p-6"
      >
        {/* ── Page header ── */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-ink-900">Automation</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              Define trigger-based rules that automatically update issues when
              events occur. Every evaluation is logged in the run history.
            </p>
          </div>
          <Button
            data-testid="automation-new"
            size="sm"
            onClick={openCreate}
            className="shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </svg>
            New rule
          </Button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-ink-200">
          {(
            [
              { id: 'rules' as Tab, label: 'Rules' },
              { id: 'runs' as Tab, label: 'Run log' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative -mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-[120ms]',
                activeTab === tab.id
                  ? 'border-signal-600 text-signal-700 font-semibold'
                  : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              {tab.label}
              {tab.id === 'rules' && rules.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-100 px-1 text-[10px] font-bold text-signal-700">
                  {rules.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="mt-4">
          {activeTab === 'rules' && (
            <RulesTab
              projectId={projectId}
              rules={rules}
              isLoading={automationsQuery.isLoading}
              isError={automationsQuery.isError}
              error={automationsQuery.error}
              onRefetch={() => void automationsQuery.refetch()}
              onEdit={openEdit}
              onDelete={setDeletingRule}
              onNew={openCreate}
            />
          )}

          {activeTab === 'runs' && (
            <AutomationRunsPanel projectId={projectId} limit={100} />
          )}
        </div>
      </div>

      {/* ── Rule editor modal ── */}
      <AutomationRuleEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        projectId={projectId}
        rule={editingRule}
        statuses={statuses}
        labels={labels}
        members={members}
        customFields={customFields}
      />

      {/* ── Delete confirm ── */}
      <ConfirmDialog
        open={deletingRule !== null}
        title="Delete automation rule"
        message={
          <>
            Delete the rule{' '}
            <span className="font-semibold text-ink-900">
              {deletingRule?.name}
            </span>
            ? This cannot be undone. Existing run history will be preserved.
          </>
        }
        confirmLabel="Delete rule"
        variant="danger"
        loading={deleteRule.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeletingRule(null)}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Rules tab
// ---------------------------------------------------------------------------

function RulesTab({
  projectId,
  rules,
  isLoading,
  isError,
  error,
  onRefetch,
  onEdit,
  onDelete,
  onNew,
}: {
  projectId: string;
  rules: AutomationRuleDto[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRefetch: () => void;
  onEdit: (rule: AutomationRuleDto) => void;
  onDelete: (rule: AutomationRuleDto) => void;
  onNew: () => void;
}) {
  if (isLoading) {
    return <LoadingState label="Loading rules…" />;
  }

  if (isError) {
    return <ErrorState error={error} onRetry={onRefetch} />;
  }

  if (rules.length === 0) {
    return (
      <EmptyState
        title="No automation rules yet"
        description="Automation rules run automatically when project events occur — create issues, change status, add comments, and more. Build your first rule to get started."
        action={
          <Button size="sm" onClick={onNew} data-testid="automation-new-empty">
            Create first rule
          </Button>
        }
        icon={
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 4l-7 9h4l-1 7 7-9h-4z" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
      <ul className="divide-y divide-ink-100">
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            projectId={projectId}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
}
