/**
 * LinkedIssuesSection
 *
 * Rendered in the IssueDetailDrawer sidebar. Displays existing issue links
 * grouped by their human label (e.g. "blocks", "is blocked by", "relates to"),
 * and provides an "Add link" affordance with a type selector and issue-key
 * input. MEMBER+ required to add/remove links.
 */
import { useRef, useState } from 'react';
import {
  ISSUE_LINK_TYPE_LABELS,
  IssueLinkType,
  type IssueLinkDto,
  type IssueRefDto,
} from '@next-lane/shared';
import {
  useIssueLinks,
  useAddIssueLink,
  useRemoveIssueLink,
} from '@/api/issue-links';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

const LINK_TYPE_OPTIONS = Object.values(IssueLinkType).map((type) => ({
  value: type,
  label: ISSUE_LINK_TYPE_LABELS[type],
}));

interface Props {
  issueId: string;
  /** When false (VIEWER), add/remove affordances are hidden. */
  editable: boolean;
  onOpenIssue: (id: string) => void;
}

export function LinkedIssuesSection({ issueId, editable, onOpenIssue }: Props) {
  const linksQuery = useIssueLinks(issueId);
  const links = linksQuery.data ?? [];

  // Group links by their label (already resolved from the viewer's perspective).
  const grouped = groupByLabel(links);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500">
        Linked issues
      </p>

      {linksQuery.isLoading ? (
        <p className="text-xs text-ink-400">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-ink-400">No linked issues.</p>
      ) : (
        <ul className="space-y-3">
          {grouped.map(({ label, items }) => (
            <li key={label}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                {label}
              </p>
              <ul className="space-y-1">
                {items.map((link) => (
                  <li key={link.id}>
                    <LinkRow
                      link={link}
                      issueId={issueId}
                      editable={editable}
                      onOpenIssue={onOpenIssue}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {editable && <AddLinkForm issueId={issueId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual link row
// ---------------------------------------------------------------------------

function LinkRow({
  link,
  issueId,
  editable,
  onOpenIssue,
}: {
  link: IssueLinkDto;
  issueId: string;
  editable: boolean;
  onOpenIssue: (id: string) => void;
}) {
  const remove = useRemoveIssueLink(issueId);
  const toast = useToast();
  const ref = link.relatedIssue;

  return (
    <div
      data-testid="issue-link-row"
      className="flex items-center gap-1.5 rounded-md border border-ink-100 bg-white px-2 py-1.5 transition-colors duration-[120ms] hover:border-ink-200"
    >
      <button
        type="button"
        onClick={() => onOpenIssue(ref.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1 rounded"
      >
        <IssueStatusDot refIssue={ref} />
        <span className="shrink-0 font-mono text-[11px] font-semibold text-signal-600">
          {ref.key}
        </span>
        <span className="flex-1 truncate text-xs text-ink-800">{ref.title}</span>
        {ref.status && (
          <span className="shrink-0 rounded-full bg-ink-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-500">
            {ref.status.name}
          </span>
        )}
      </button>

      {editable && (
        <button
          type="button"
          data-testid="issue-link-remove"
          aria-label={`Remove link to ${ref.key}`}
          onClick={() =>
            remove.mutate(link.id, {
              onError: (err) =>
                toast.error(errorMessage(err, 'Could not remove link.')),
            })
          }
          disabled={remove.isPending}
          className="ml-0.5 shrink-0 rounded p-0.5 text-ink-300 transition-colors duration-[120ms] hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Small colored dot conveying the related issue's status category. */
function IssueStatusDot({ refIssue }: { refIssue: IssueRefDto }) {
  const category = refIssue.status?.category;
  const colorClass =
    category === 'DONE'
      ? 'bg-emerald-400'
      : category === 'IN_PROGRESS'
        ? 'bg-signal-500'
        : 'bg-ink-300';
  return (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 rounded-full ${colorClass}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Add-link form
// ---------------------------------------------------------------------------

function AddLinkForm({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IssueLinkType>(IssueLinkType.RELATES_TO);
  const [target, setTarget] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useAddIssueLink(issueId);
  const toast = useToast();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = target.trim();
    if (!trimmed) return;
    add.mutate(
      { target: trimmed, type },
      {
        onSuccess: () => {
          setTarget('');
          setOpen(false);
          toast.success('Link added.');
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not add link.'));
        },
      },
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="issue-link-add"
        onClick={() => {
          setOpen(true);
          // Focus the input on next tick after render.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="rounded text-xs font-medium text-signal-600 hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300"
      >
        + Add link
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-1 space-y-2 rounded-lg border border-ink-200 bg-ink-50/50 p-3"
    >
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          Link type
        </label>
        <Select
          data-testid="issue-link-type"
          value={type}
          onChange={(e) => setType(e.target.value as IssueLinkType)}
        >
          {LINK_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          Issue key or ID
        </label>
        <Input
          ref={inputRef}
          data-testid="issue-link-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. NL-5"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
              setTarget('');
            }
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          variant="primary"
          loading={add.isPending}
          disabled={!target.trim()}
        >
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTarget('');
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByLabel(
  links: IssueLinkDto[],
): Array<{ label: string; items: IssueLinkDto[] }> {
  const order: string[] = [];
  const map = new Map<string, IssueLinkDto[]>();

  for (const link of links) {
    if (!map.has(link.label)) {
      map.set(link.label, []);
      order.push(link.label);
    }
    map.get(link.label)!.push(link);
  }

  return order.map((label) => ({ label, items: map.get(label)! }));
}
