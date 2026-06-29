import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BoardType,
  BOARD_TYPES,
  validateQuery,
  type BoardColorRule,
  type BoardSummaryDto,
} from '@next-lane/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { useBoards, useCreateBoard, useUpdateBoard, useDeleteBoard } from '@/api/boards';
import { useCustomFields } from '@/api/custom-fields';
import { CardColorsManager } from './CardColorsManager';
import { NlqlInput } from './NlqlInput';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Display label for a board type. */
function boardTypeLabel(type: BoardType): string {
  return type === BoardType.KANBAN ? 'Kanban' : 'Scrum';
}

/** Small badge showing the board type. */
function BoardTypeBadge({ type }: { type: BoardType }) {
  const isKanban = type === BoardType.KANBAN;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        isKanban
          ? 'bg-brand-50 text-brand-700'
          : 'bg-violet-50 text-violet-700',
      )}
    >
      {boardTypeLabel(type)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create board modal
// ---------------------------------------------------------------------------

interface CreateBoardModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: (board: BoardSummaryDto) => void;
}

function CreateBoardModal({
  open,
  onClose,
  projectId,
  onCreated,
}: CreateBoardModalProps) {
  const toast = useToast();
  const createBoard = useCreateBoard(projectId);
  const [name, setName] = useState('');
  const [type, setType] = useState<BoardType>(BoardType.KANBAN);

  // Reset form when modal opens.
  useEffect(() => {
    if (open) {
      setName('');
      setType(BoardType.KANBAN);
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createBoard.mutate(
      { name: trimmed, type },
      {
        onSuccess: (board) => {
          toast.success(`Board "${board.name}" created.`);
          onCreated(board);
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not create board.')),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New board"
      size="max-w-sm"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-board-form"
            loading={createBoard.isPending}
            disabled={!name.trim()}
            data-testid="board-create-button"
          >
            Create board
          </Button>
        </>
      }
    >
      <form id="create-board-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="board-create-name"
            className="block text-xs font-semibold text-slate-600"
          >
            Name
          </label>
          <Input
            id="board-create-name"
            data-testid="board-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sprint board"
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="board-type-select"
            className="block text-xs font-semibold text-slate-600"
          >
            Type
          </label>
          <Select
            id="board-type-select"
            data-testid="board-type-select"
            value={type}
            onChange={(e) => setType(e.target.value as BoardType)}
          >
            {BOARD_TYPES.map((t) => (
              <option key={t} value={t}>
                {boardTypeLabel(t)}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Board settings modal (rename / change type)
// ---------------------------------------------------------------------------

type SettingsTab = 'general' | 'colors';

interface BoardSettingsModalProps {
  open: boolean;
  onClose: () => void;
  board: BoardSummaryDto;
  projectId: string;
  onDeleted: () => void;
  /** Initial tab to open (default: 'general'). */
  initialTab?: SettingsTab;
}

function BoardSettingsModal({
  open,
  onClose,
  board,
  projectId,
  onDeleted,
  initialTab = 'general',
}: BoardSettingsModalProps) {
  const toast = useToast();
  const updateBoard = useUpdateBoard(projectId);
  const deleteBoard = useDeleteBoard(projectId);
  const customFieldsQuery = useCustomFields(projectId);

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [name, setName] = useState(board.name);
  const [type, setType] = useState<BoardType>(board.type);
  const [filterQuery, setFilterQuery] = useState(board.filterQuery ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Keep form in sync when the board prop changes (e.g. switcher navigates).
  useEffect(() => {
    setName(board.name);
    setType(board.type);
    setFilterQuery(board.filterQuery ?? '');
    setActiveTab(initialTab);
  }, [board.id, board.name, board.type, board.filterQuery, initialTab]);

  const cfDefs = useMemo(
    () =>
      (customFieldsQuery.data ?? []).map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        type: d.type,
      })),
    [customFieldsQuery.data],
  );

  // Validate the board's default filter live so we never persist a broken query.
  const filterError = useMemo(() => {
    const q = filterQuery.trim();
    if (!q) return null;
    const res = validateQuery(q, { customFieldDefs: cfDefs });
    return res.ok ? null : (res.error?.message ?? 'Invalid query');
  }, [filterQuery, cfDefs]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || filterError) return;
    updateBoard.mutate(
      {
        boardId: board.id,
        patch: { name: trimmed, type, filterQuery: filterQuery.trim() || null },
      },
      {
        onSuccess: () => {
          toast.success('Board updated.');
          onClose();
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not update board.')),
      },
    );
  }

  function handleDelete() {
    if (board.isDefault) {
      toast.error('The default board cannot be deleted.');
      setConfirmDelete(false);
      return;
    }
    deleteBoard.mutate(board.id, {
      onSuccess: () => {
        toast.success(`Board "${board.name}" deleted.`);
        setConfirmDelete(false);
        onClose();
        onDeleted();
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Could not delete board.'));
        setConfirmDelete(false);
      },
    });
  }

  async function handleSaveColorRules(rules: BoardColorRule[]) {
    await updateBoard.mutateAsync(
      { boardId: board.id, patch: { colorRules: rules } },
    );
    toast.success('Card colors saved.');
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'colors', label: 'Card colors' },
  ];

  return (
    <>
      {/* BUG 2 FIX: hide the settings modal while the confirm dialog is open so
          its backdrop (z-50) does not intercept pointer events on the confirm
          dialog's buttons. Both modals portal to document.body at z-50; the
          settings backdrop's onClick would otherwise steal the click. */}
      <Modal
        open={open && !confirmDelete}
        onClose={onClose}
        title="Board settings"
        size="max-w-md"
        footer={
          activeTab === 'general' ? (
            <div className="flex w-full items-center justify-between">
              <Button
                variant="danger"
                size="sm"
                type="button"
                data-testid="board-delete-button"
                disabled={board.isDefault}
                title={
                  board.isDefault
                    ? 'Cannot delete the default board'
                    : 'Delete this board'
                }
                onClick={() => {
                  if (board.isDefault) {
                    toast.error('The default board cannot be deleted.');
                    return;
                  }
                  setConfirmDelete(true);
                }}
              >
                Delete board
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" type="button" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="board-settings-form"
                  loading={updateBoard.isPending}
                  disabled={!name.trim() || !!filterError}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" type="button" onClick={onClose}>
              Close
            </Button>
          )
        }
      >
        {/* Tab bar */}
        <div className="mb-4 flex gap-1 border-b border-slate-100 pb-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={tab.id === 'colors' ? 'card-colors-open' : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-t px-3 py-1.5 text-xs font-semibold transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                activeTab === tab.id
                  ? 'border-b-2 border-brand-600 text-brand-700'
                  : 'text-slate-500 hover:text-slate-700',
              )}
              aria-selected={activeTab === tab.id}
              role="tab"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* General tab */}
        {activeTab === 'general' && (
          <form id="board-settings-form" onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="board-settings-name"
                className="block text-xs font-semibold text-slate-600"
              >
                Name
              </label>
              <Input
                id="board-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="board-settings-type"
                className="block text-xs font-semibold text-slate-600"
              >
                Type
              </label>
              <Select
                id="board-settings-type"
                value={type}
                onChange={(e) => setType(e.target.value as BoardType)}
              >
                {BOARD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {boardTypeLabel(t)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="block text-xs font-semibold text-slate-600" aria-hidden="true">
                Default filter{' '}
                <span className="font-normal text-slate-400">(NLQL — always applied to this board)</span>
              </p>
              <NlqlInput
                value={filterQuery}
                onChange={setFilterQuery}
                projectId={projectId}
                customFieldDefs={cfDefs}
                aria-label="Board default filter (NLQL)"
                aria-invalid={!!filterError}
                placeholder="e.g. type = EPIC"
                data-testid="board-default-filter"
              />
              {filterError ? (
                <p role="alert" className="text-xs text-red-600">
                  {filterError}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Only issues matching this query appear on the board (your other
                  filters still apply on top). Leave empty to show everything.
                </p>
              )}
            </div>
            {board.isDefault && (
              <p className="text-xs text-slate-400">
                This is the default board and cannot be deleted.
              </p>
            )}
          </form>
        )}

        {/* Card colors tab */}
        {activeTab === 'colors' && (
          <CardColorsManager
            boardId={board.id}
            projectId={projectId}
            initialRules={board.colorRules ?? []}
            customFieldDefs={customFieldsQuery.data ?? []}
            onSave={handleSaveColorRules}
            isSaving={updateBoard.isPending}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete board"
        message={
          <>
            Delete <strong>{board.name}</strong>? This cannot be undone. Issues
            on this board will not be deleted.
          </>
        }
        confirmLabel="Delete board"
        variant="danger"
        loading={deleteBoard.isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main BoardSwitcher
// ---------------------------------------------------------------------------

export interface BoardSwitcherProps {
  projectId: string;
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  /** Called after a board is deleted so the parent can fall back to the default. */
  onBoardDeleted: () => void;
  /**
   * When true the settings modal for the selected board opens immediately on the
   * "Card colors" tab. Used by the board toolbar's "Card colors" button.
   */
  openColorsTab?: boolean;
  /** Callback to reset `openColorsTab` after the modal has opened. */
  onColorsTabOpened?: () => void;
}

/**
 * Dropdown that lists a project's boards and lets the user switch between them,
 * create a new board, or open per-board settings (rename/type/delete).
 */
export function BoardSwitcher({
  projectId,
  selectedBoardId,
  onSelectBoard,
  onBoardDeleted,
  openColorsTab = false,
  onColorsTabOpened,
}: BoardSwitcherProps) {
  const boardsQuery = useBoards(projectId);
  const boards = boardsQuery.data ?? [];
  const selected = boards.find((b) => b.id === selectedBoardId) ?? boards[0];

  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [settingsBoard, setSettingsBoard] = useState<BoardSummaryDto | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general');
  const containerRef = useRef<HTMLDivElement>(null);

  // When parent asks to open the colors tab for the selected board, do so.
  useEffect(() => {
    if (!openColorsTab || !selected) return;
    setSettingsBoard(selected);
    setSettingsInitialTab('colors');
    onColorsTabOpened?.();
  }, [openColorsTab, selected, onColorsTabOpened]);

  // Close the dropdown when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!boards.length && !boardsQuery.isLoading) return null;

  return (
    <>
      <div ref={containerRef} className="relative">
        {/* Trigger button */}
        <button
          type="button"
          data-testid="board-switcher"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={selected ? `Board: ${selected.name}` : 'Select board'}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-800',
            'transition-colors hover:bg-slate-50 hover:border-slate-300',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
            open && 'border-brand-300 bg-brand-50',
          )}
        >
          {/* Board icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="text-brand-500"
          >
            <rect x="3" y="3" width="5" height="18" rx="1" />
            <rect x="11" y="3" width="5" height="12" rx="1" />
            <rect x="19" y="3" width="2" height="8" rx="1" />
          </svg>
          {selected ? (
            <>
              <span className="max-w-[10rem] truncate">{selected.name}</span>
              <BoardTypeBadge type={selected.type} />
            </>
          ) : (
            <span className="text-slate-400">Select board</span>
          )}
          {/* Chevron */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
            className={cn('text-slate-400 transition-transform', open && 'rotate-180')}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown panel */}
        {open && (
          <div
            role="listbox"
            aria-label="Board list"
            className={cn(
              'absolute left-0 top-full z-30 mt-1 min-w-[220px] rounded-xl border border-slate-200',
              'bg-white p-1.5 shadow-dropdown',
            )}
          >
            {/* Board list */}
            <ul className="space-y-0.5">
              {boards.map((board) => {
                const isActive = board.id === selectedBoardId;
                return (
                  <li key={board.id}>
                    <div
                      className={cn(
                        'group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer',
                        isActive
                          ? 'bg-brand-50 text-brand-800'
                          : 'text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        data-testid="board-switcher-option"
                        data-board-id={board.id}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium focus:outline-none"
                        onClick={() => {
                          onSelectBoard(board.id);
                          setOpen(false);
                        }}
                      >
                        {/* Active checkmark */}
                        <span
                          className={cn(
                            'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full',
                            isActive ? 'bg-brand-600' : 'bg-transparent',
                          )}
                        >
                          {isActive && (
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="white"
                              strokeWidth="3"
                              aria-hidden="true"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span className="min-w-0 truncate">{board.name}</span>
                        {board.isDefault && (
                          <span className="ml-auto text-[10px] font-medium text-slate-400">
                            default
                          </span>
                        )}
                        <BoardTypeBadge type={board.type} />
                      </button>
                      {/* Settings gear */}
                      <button
                        type="button"
                        aria-label={`Board settings for ${board.name}`}
                        data-testid="board-settings-button"
                        className={cn(
                          'flex-shrink-0 rounded p-1 text-slate-400 opacity-0 transition-opacity',
                          'hover:bg-slate-200 hover:text-slate-600',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                          'group-hover:opacity-100 focus:opacity-100',
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettingsBoard(board);
                          setSettingsInitialTab('general');
                          setOpen(false);
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Divider + New board action */}
            <div className="mt-1 border-t border-slate-100 pt-1">
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600',
                  'hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                )}
                onClick={() => {
                  setOpen(false);
                  setShowCreate(true);
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                </svg>
                New board
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateBoardModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        projectId={projectId}
        onCreated={(board) => onSelectBoard(board.id)}
      />

      {settingsBoard && (
        <BoardSettingsModal
          open={!!settingsBoard}
          onClose={() => { setSettingsBoard(null); setSettingsInitialTab('general'); }}
          board={settingsBoard}
          projectId={projectId}
          onDeleted={onBoardDeleted}
          initialTab={settingsInitialTab}
        />
      )}
    </>
  );
}
