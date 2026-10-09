/**
 * NlqlQueryBar — the board's query strip (NLQL input + saved filters).
 *
 * Lives behind the toolbar's "Query" toggle (auto-open when `?q=` is set) so
 * the default toolbar is a single row. Controls are 36px (40px on touch
 * viewports), radius-md, ink/signal tokens only.
 */
import { useEffect, useRef, useState } from 'react';
import type { SavedFilterDto } from '@next-lane/shared';
import {
  useCreateSavedFilter,
  useUpdateSavedFilter,
  useDeleteSavedFilter,
} from '@/api/saved-filters';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DropdownPanel } from '@/components/ui/DropdownPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import { NlqlInput } from './NlqlInput';

export type NlqlValidation = { ok: boolean; error?: { message: string; position: number } } | null;

interface NlqlQueryBarProps {
  value: string;
  onChange: (v: string) => void;
  validation: NlqlValidation;
  projectId: string;
  savedFilters: SavedFilterDto[];
  currentUserId: string;
  statuses?: string[];
  customFieldDefs?: Array<{ id: string; key: string; name: string; type: string }>;
}

export function NlqlQueryBar({
  value,
  onChange,
  validation,
  projectId,
  savedFilters,
  currentUserId,
  statuses,
  customFieldDefs,
}: NlqlQueryBarProps) {
  const toast = useToast();
  const [helpOpen, setHelpOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveShared, setSaveShared] = useState(false);
  const [editFilter, setEditFilter] = useState<SavedFilterDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editShared, setEditShared] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedFilterDto | null>(null);

  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const helpPanelRef = useRef<HTMLDivElement>(null);

  const createMutation = useCreateSavedFilter(projectId);
  const updateMutation = useUpdateSavedFilter(projectId);
  const deleteMutation = useDeleteSavedFilter(projectId);

  // Close filter menu on outside click / Escape
  useEffect(() => {
    if (!filterMenuOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !filterMenuRef.current?.contains(target) &&
        !filterPanelRef.current?.contains(target)
      ) {
        setFilterMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFilterMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterMenuOpen]);

  // Close help on outside click / Escape
  useEffect(() => {
    if (!helpOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!helpRef.current?.contains(target) && !helpPanelRef.current?.contains(target)) {
        setHelpOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setHelpOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [helpOpen]);

  const hasQuery = value.trim().length > 0;
  const isInvalid = hasQuery && validation !== null && !validation.ok;
  const canSave = hasQuery && (validation === null || validation.ok);

  function handleSelectFilter(sf: SavedFilterDto) {
    onChange(sf.query);
    setFilterMenuOpen(false);
  }

  function openSaveModal() {
    setSaveName('');
    setSaveShared(false);
    setSaveModalOpen(true);
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    try {
      await createMutation.mutateAsync({
        name: saveName.trim(),
        query: value.trim(),
        shared: saveShared,
      });
      setSaveModalOpen(false);
      toast.success('Filter saved.');
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save filter.'));
    }
  }

  function openEditModal(sf: SavedFilterDto) {
    setEditFilter(sf);
    setEditName(sf.name);
    setEditShared(sf.shared);
  }

  async function handleUpdate() {
    if (!editFilter || !editName.trim()) return;
    try {
      await updateMutation.mutateAsync({
        id: editFilter.id,
        input: { name: editName.trim(), shared: editShared },
      });
      setEditFilter(null);
      toast.success('Filter updated.');
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to update filter.'));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast.success('Filter deleted.');
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete filter.'));
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        {/* Bar row */}
        <div className="flex items-center gap-1.5">
          {/* Saved-filter selector */}
          <div ref={filterMenuRef} className="relative">
            <button
              type="button"
              data-testid="saved-filter-select"
              aria-label="Saved filters"
              aria-expanded={filterMenuOpen}
              aria-haspopup="menu"
              onClick={() => setFilterMenuOpen((v) => !v)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors max-sm:h-10',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
                savedFilters.length > 0
                  ? 'border-ink-200 bg-surface text-ink-700 hover:border-ink-300 hover:bg-ink-50'
                  : 'border-ink-200 bg-ink-50 text-ink-500',
              )}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>

            <DropdownPanel
              open={filterMenuOpen}
              anchorRef={filterMenuRef}
              panelRef={filterPanelRef}
              role="menu"
              aria-label="Saved filters menu"
              className="w-64 rounded-xl border border-ink-200 bg-surface shadow-dropdown"
            >
              <>
                <div className="border-b border-ink-100 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Saved filters
                  </p>
                </div>
                {savedFilters.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-ink-400">
                    No saved filters yet. Type a query and click Save.
                  </p>
                ) : (
                  <ul className="max-h-56 overflow-y-auto py-1">
                    {savedFilters.map((sf) => (
                      <li key={sf.id} className="flex items-center gap-1 px-1">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => handleSelectFilter(sf)}
                          className="flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-ink-700 max-sm:py-3 hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
                        >
                          <span className="truncate">{sf.name}</span>
                          {sf.shared && (
                            <span className="shrink-0 rounded bg-signal-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-signal-600">
                              shared
                            </span>
                          )}
                        </button>
                        {sf.ownerId === currentUserId && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              aria-label={`Edit filter ${sf.name}`}
                              onClick={() => { openEditModal(sf); setFilterMenuOpen(false); }}
                              className="rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 max-sm:p-3"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete filter ${sf.name}`}
                              onClick={() => { setDeleteTarget(sf); setFilterMenuOpen(false); }}
                              className="rounded p-1.5 text-ink-500 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 max-sm:p-3"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-6 0V5a1 1 0 011-1h4a1 1 0 011 1v2M9 7H4m16 0h-5" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            </DropdownPanel>
          </div>

          {/* Query input — smart autocomplete */}
          <div className="relative flex-1 sm:min-w-[18rem]">
            <NlqlInput
              value={value}
              onChange={onChange}
              projectId={projectId}
              statuses={statuses}
              customFieldDefs={customFieldDefs}
              aria-describedby={isInvalid ? 'nlql-error-msg' : undefined}
              aria-invalid={isInvalid}
              className={cn('pr-9 max-sm:h-10', isInvalid && 'border-red-400 focus:border-red-500 focus:ring-red-200')}
            />
            {hasQuery && (
              <button
                type="button"
                aria-label="Clear query"
                onClick={() => onChange('')}
                className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded p-2 text-ink-500 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            )}
          </div>

          {/* Help button */}
          <div ref={helpRef} className="relative">
            <button
              type="button"
              aria-label="NLQL query help"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((v) => !v)}
              className="inline-flex h-9 w-9 max-sm:h-10 max-sm:w-10 items-center justify-center rounded-md border border-ink-200 bg-surface text-ink-500 transition-colors duration-[120ms] hover:bg-ink-50 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
            >
              <span className="text-xs font-bold leading-none">?</span>
            </button>

            <DropdownPanel
              open={helpOpen}
              anchorRef={helpRef}
              panelRef={helpPanelRef}
              align="end"
              role="dialog"
              aria-label="NLQL help"
              className="w-72 rounded-xl border border-ink-200 bg-surface p-3 shadow-dropdown"
            >
              <>
                <p className="mb-2 text-xs font-semibold text-ink-700">Query language reference</p>
                <div className="space-y-1.5 text-xs text-ink-600">
                  <p className="font-medium text-ink-500">Fields</p>
                  <code className="block text-[11px] text-ink-700">priority, type, status, assignee, labels, dueDate, storyPoints, title, text, key</code>
                  <p className="mt-1.5 font-medium text-ink-500">Operators</p>
                  <code className="block text-[11px] text-ink-700">= != &gt; &lt; &gt;= &lt;= ~ !~ IN NOT IN IS EMPTY</code>
                  <p className="mt-1.5 font-medium text-ink-500">Examples</p>
                  <ul className="space-y-1 font-mono text-[11px] text-ink-700">
                    <li><code>priority = HIGH</code></li>
                    <li><code>type IN (BUG, TASK)</code></li>
                    <li><code>assignee = me()</code></li>
                    <li><code>dueDate &lt; today()</code></li>
                    <li><code>title ~ "login"</code></li>
                    <li><code>labels = "critical"</code></li>
                    <li><code>priority &gt; MEDIUM AND assignee IS EMPTY</code></li>
                  </ul>
                </div>
              </>
            </DropdownPanel>
          </div>

          {/* Save button */}
          <button
            type="button"
            data-testid="saved-filter-save"
            aria-label="Save current filter"
            disabled={!canSave}
            onClick={openSaveModal}
            className={cn(
              'inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm font-medium transition-colors max-sm:h-10',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
              canSave
                ? 'border-signal-300 bg-signal-50 text-signal-700 hover:bg-signal-100'
                : 'cursor-not-allowed border-ink-200 bg-ink-50 text-ink-400',
            )}
          >
            Save
          </button>
        </div>

        {/* Inline error */}
        {isInvalid && validation?.error && (
          <p
            id="nlql-error-msg"
            data-testid="nlql-error"
            role="alert"
            className="text-xs text-red-600"
          >
            {validation.error.message}
          </p>
        )}
      </div>

      {/* Save filter modal */}
      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save filter"
        size="max-w-sm"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={createMutation.isPending}
              disabled={!saveName.trim()}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700" htmlFor="sf-name">
              Filter name
            </label>
            <Input
              id="sf-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. My HIGH priority bugs"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              autoFocus
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={saveShared}
              onChange={(e) => setSaveShared(e.target.checked)}
              className="rounded border-ink-300 text-signal-600 focus:ring-signal-500"
            />
            <span className="text-sm text-ink-700">Share with project members</span>
          </label>
          <p className="text-xs text-ink-500 font-mono truncate" title={value.trim()}>
            Query: {value.trim()}
          </p>
        </div>
      </Modal>

      {/* Edit filter modal */}
      <Modal
        open={editFilter !== null}
        onClose={() => setEditFilter(null)}
        title="Edit filter"
        size="max-w-sm"
        footer={
          <>
            <Button variant="secondary" type="button" onClick={() => setEditFilter(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={updateMutation.isPending}
              disabled={!editName.trim()}
              onClick={() => void handleUpdate()}
            >
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700" htmlFor="sf-edit-name">
              Filter name
            </label>
            <Input
              id="sf-edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleUpdate(); }}
              autoFocus
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={editShared}
              onChange={(e) => setEditShared(e.target.checked)}
              className="rounded border-ink-300 text-signal-600 focus:ring-signal-500"
            />
            <span className="text-sm text-ink-700">Share with project members</span>
          </label>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete saved filter"
        message={
          <>
            Are you sure you want to delete{' '}
            <strong>{deleteTarget?.name}</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

