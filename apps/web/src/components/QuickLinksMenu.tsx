/**
 * Quick Links — a header dropdown of the user's personal shortcuts.
 *
 * Links can carry an accent color (curated palette) and a free-text group;
 * grouped links render under collapsible headers with a color dot, which keeps
 * a large set (25+) scannable. Add/edit share one form.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import type { QuickLinkDto } from '@next-lane/shared';
import {
  useQuickLinks,
  useCreateQuickLink,
  useUpdateQuickLink,
  useDeleteQuickLink,
} from '@/api/quick-links';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

// Curated accent palette — readable on white, distinct from each other. Stored
// as hex; `null` means no color.
const PALETTE: { name: string; hex: string }[] = [
  { name: 'Slate', hex: '#64748b' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Cyan', hex: '#0891b2' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Pink', hex: '#db2777' },
];

const inputCls =
  'h-7 w-full rounded border border-ink-200 bg-white px-2 text-xs text-ink-900 placeholder:text-ink-400 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-200';

const UNGROUPED = '__ungrouped__';

function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'URL must start with http:// or https://';
    }
    return null;
  } catch {
    return 'Please enter a valid URL (http:// or https://)';
  }
}

// ── Color swatch picker ───────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Accent color">
      {/* None */}
      <button
        type="button"
        onClick={() => onChange(null)}
        role="radio"
        aria-checked={value === null}
        aria-label="No color"
        title="No color"
        data-testid="quick-link-color-none"
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-ink-400 ${
          value === null
            ? 'border-ink-400 ring-2 ring-ink-300 ring-offset-1'
            : 'border-ink-200 hover:border-ink-300'
        }`}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" d="M5 19L19 5" />
        </svg>
      </button>
      {PALETTE.map((c) => (
        <button
          key={c.hex}
          type="button"
          onClick={() => onChange(c.hex)}
          role="radio"
          aria-checked={value === c.hex}
          aria-label={c.name}
          title={c.name}
          data-testid="quick-link-color-swatch"
          className={`h-5 w-5 rounded-full ${
            value === c.hex ? 'ring-2 ring-offset-1 ring-ink-400' : 'hover:scale-110'
          } transition-transform`}
          style={{ backgroundColor: c.hex }}
        />
      ))}
    </div>
  );
}

// ── Shared add/edit form ──────────────────────────────────────────────────────

interface FormValues {
  label: string;
  url: string;
  color: string | null;
  group: string | null;
}

function QuickLinkForm({
  initial,
  groups,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
  idPrefix,
}: {
  initial: FormValues;
  groups: string[];
  submitting: boolean;
  submitLabel: string;
  onSubmit: (v: FormValues) => void;
  onCancel?: () => void;
  idPrefix: string;
}) {
  const [label, setLabel] = useState(initial.label);
  const [url, setUrl] = useState(initial.url);
  const [color, setColor] = useState<string | null>(initial.color);
  const [group, setGroup] = useState(initial.group ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const l = label.trim();
    const u = url.trim();
    if (!l) {
      setError('Label is required.');
      return;
    }
    const urlErr = validateUrl(u);
    if (urlErr) {
      setError(urlErr);
      return;
    }
    setError(null);
    onSubmit({ label: l, url: u, color, group: group.trim() || null });
  }

  const listId = `${idPrefix}-groups`;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={submitLabel}
      data-testid="quick-link-form"
      className="flex flex-col gap-1.5"
    >
      <input
        type="text"
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
          setError(null);
        }}
        placeholder="Label (e.g. Figma)"
        aria-label="Quick link label"
        data-testid="add-quick-link-label"
        className={inputCls}
      />
      <input
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        placeholder="https://…"
        aria-label="Quick link URL"
        data-testid="add-quick-link-url"
        className={inputCls}
      />
      <input
        type="text"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        placeholder="Group (optional)"
        aria-label="Quick link group"
        data-testid="add-quick-link-group"
        list={listId}
        maxLength={40}
        className={inputCls}
      />
      <datalist id={listId}>
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <ColorPicker value={color} onChange={setColor} />
      {error && (
        <p className="text-xs text-red-600" role="alert" data-testid="add-quick-link-error">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-0.5 text-xs text-ink-500 hover:bg-ink-100"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          data-testid="add-quick-link-submit"
          className="flex items-center justify-center gap-1.5 rounded bg-signal-600 px-3 py-1 text-xs font-semibold text-white transition-colors duration-[120ms] hover:bg-signal-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── Single link row ───────────────────────────────────────────────────────────

function LinkRow({
  link,
  onEdit,
  onDelete,
  deleting,
}: {
  link: QuickLinkDto;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <li
      className="flex items-center gap-2 border-b border-ink-50 px-3 py-2 last:border-0"
      data-testid="quick-link-row"
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{
          backgroundColor: link.color ?? 'transparent',
          boxShadow: link.color ? undefined : 'inset 0 0 0 1.5px var(--tw-ring-color, #cbd5e1)',
        }}
      />
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        role="menuitem"
        className="min-w-0 flex-1 truncate text-sm text-ink-700 underline-offset-2 hover:text-signal-700 hover:underline focus-visible:outline-none focus-visible:underline"
        title={link.url}
      >
        {link.label}
      </a>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit quick link: ${link.label}`}
        data-testid="quick-link-edit"
        className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-signal-500"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 0 1 2.828 0l.172.172a2 2 0 0 1 0 2.828L12 16H9v-3z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete quick link: ${link.label}`}
        data-testid="quick-link-delete"
        disabled={deleting}
        className="shrink-0 rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 disabled:opacity-50"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}

// ── Menu ──────────────────────────────────────────────────────────────────────

export function QuickLinksMenu() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const { data: links = [], isLoading } = useQuickLinks();
  const createLink = useCreateQuickLink();
  const deleteLink = useDeleteQuickLink();
  const updateLink = useUpdateQuickLink();

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Existing group names for the datalist (de-duped, in first-seen order).
  const groupNames = useMemo(() => {
    const seen: string[] = [];
    for (const l of links) {
      if (l.group && !seen.includes(l.group)) seen.push(l.group);
    }
    return seen;
  }, [links]);

  // Group links: named groups first (by their earliest `order`), ungrouped last.
  // `links` already arrives ordered by `order` from the API.
  const sections = useMemo(() => {
    const map = new Map<string, QuickLinkDto[]>();
    for (const l of links) {
      const key = l.group ?? UNGROUPED;
      const arr = map.get(key);
      if (arr) arr.push(l);
      else map.set(key, [l]);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === UNGROUPED) return 1;
      if (b[0] === UNGROUPED) return -1;
      return a[1][0].order - b[1][0].order;
    });
  }, [links]);

  const hasNamedGroup = sections.some(([k]) => k !== UNGROUPED);

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleCreate(v: FormValues) {
    createLink.mutate(v, {
      onSuccess: () => toast.success('Quick link added.'),
      onError: (err) => toast.error(errorMessage(err, 'Could not add quick link.')),
    });
  }

  function handleUpdate(id: string, v: FormValues) {
    updateLink.mutate(
      { id, ...v },
      {
        onSuccess: () => {
          setEditingId(null);
          toast.success('Quick link updated.');
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not update quick link.')),
      },
    );
  }

  function handleDelete(link: QuickLinkDto) {
    deleteLink.mutate(link.id, {
      onError: (err) => toast.error(errorMessage(err, 'Could not delete quick link.')),
    });
  }

  function renderLink(link: QuickLinkDto) {
    if (editingId === link.id) {
      return (
        <li key={link.id} className="border-b border-ink-50 px-3 py-2 last:border-0">
          <QuickLinkForm
            idPrefix={`edit-${link.id}`}
            initial={{ label: link.label, url: link.url, color: link.color, group: link.group }}
            groups={groupNames}
            submitting={updateLink.isPending}
            submitLabel="Save"
            onCancel={() => setEditingId(null)}
            onSubmit={(v) => handleUpdate(link.id, v)}
          />
        </li>
      );
    }
    return (
      <LinkRow
        key={link.id}
        link={link}
        deleting={deleteLink.isPending}
        onEdit={() => setEditingId(link.id)}
        onDelete={() => handleDelete(link)}
      />
    );
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Quick links"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="quick-links-button"
        className="flex items-center gap-1.5 rounded p-2 text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1"
        title="Quick links"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 0 0-5.656 0l-4 4a4 4 0 1 0 5.656 5.656l1.102-1.101" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 0 0 5.656 0l4-4a4 4 0 0 0-5.656-5.656l-1.1 1.1" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Quick links"
          className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-dropdown animate-nl-fade-in"
        >
          <div className="border-b border-ink-100 px-3 py-2.5">
            <p className="text-sm font-semibold text-ink-900">Quick links</p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {isLoading ? (
              <p className="px-3 py-4 text-center text-sm text-ink-400">Loading…</p>
            ) : links.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-ink-400" data-testid="quick-links-empty">
                No quick links yet — add shortcuts to your apps.
              </p>
            ) : (
              sections.map(([key, groupLinks]) => {
                const isUngrouped = key === UNGROUPED;
                // Ungrouped links render headerless unless there are also named
                // groups, in which case an "Ungrouped" header keeps it clear.
                if (isUngrouped && !hasNamedGroup) {
                  return <ul key={key}>{groupLinks.map(renderLink)}</ul>;
                }
                const headerLabel = isUngrouped ? 'Ungrouped' : key;
                const isCollapsed = collapsed.has(key);
                return (
                  <div key={key} className="border-b border-ink-100 last:border-0">
                    <button
                      type="button"
                      onClick={() => toggleGroup(key)}
                      data-testid="quick-link-group-header"
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-1.5 bg-ink-50/60 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 hover:bg-ink-100 focus-visible:outline-none focus-visible:bg-ink-100"
                    >
                      <svg
                        className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                      <span className="min-w-0 truncate">{headerLabel}</span>
                      <span className="ml-auto rounded-full bg-ink-200/70 px-1.5 text-[10px] font-medium text-ink-500">
                        {groupLinks.length}
                      </span>
                    </button>
                    {!isCollapsed && <ul>{groupLinks.map(renderLink)}</ul>}
                  </div>
                );
              })
            )}
          </div>

          {/* Add link form */}
          <div className="border-t border-ink-100 p-3">
            <QuickLinkForm
              idPrefix="add"
              initial={{ label: '', url: '', color: null, group: null }}
              groups={groupNames}
              submitting={createLink.isPending}
              submitLabel="Add link"
              onSubmit={handleCreate}
            />
          </div>
        </div>
      )}
    </div>
  );
}
