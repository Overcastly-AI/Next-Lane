import { useCallback, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import {
  usePersonalBoard,
  useCreatePersonalColumn,
  useUpdatePersonalColumn,
  useDeletePersonalColumn,
  useCreatePersonalCard,
  useUpdatePersonalCard,
  useDeletePersonalCard,
  usePromotePersonalCard,
  type PersonalCardDto,
  type PersonalColumnDto,
} from '@/api/personal-board';
import { useWorkspaces } from '@/api/workspaces';
import { useProjects } from '@/api/projects';

// ---------------------------------------------------------------------------
// PersonalBoardPage
// ---------------------------------------------------------------------------

export function PersonalBoardPage() {
  const query = usePersonalBoard();
  const toast = useToast();

  const updateCard = useUpdatePersonalCard();
  const deleteCard = useDeletePersonalCard();

  // Active drag state — the card being dragged.
  const [activeCard, setActiveCard] = useState<PersonalCardDto | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const columns = query.data ?? [];

  // Flat list of all cards for the drag overlay lookup.
  const allCards = columns.flatMap((c) => c.cards ?? []);

  function onDragStart(event: DragStartEvent) {
    const card = allCards.find((c) => c.id === event.active.id);
    setActiveCard(card ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const dragged = allCards.find((c) => c.id === activeId);
    if (!dragged) return;

    // Determine target column.
    const overData = over.data.current as
      | { type?: string; columnId?: string }
      | undefined;
    const overIsColumn = overData?.type === 'column';
    const targetColumnId = overIsColumn
      ? String(over.id)
      : (overData?.columnId ?? dragged.columnId);

    const targetCol = columns.find((c) => c.id === targetColumnId);
    if (!targetCol) return;

    // Build the ordered list of cards in the target column, excluding the
    // dragged card itself.
    const colCards = (targetCol.cards ?? [])
      .filter((c) => c.id !== activeId)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));

    let insertIndex: number;
    if (overIsColumn) {
      insertIndex = colCards.length;
    } else {
      const overIdx = colCards.findIndex((c) => c.id === String(over.id));
      insertIndex = overIdx === -1 ? colCards.length : overIdx;
    }

    const beforeCard = colCards[insertIndex - 1] ?? null;
    const afterCard = colCards[insertIndex] ?? null;

    // Skip if nothing actually changed.
    if (targetColumnId === dragged.columnId) {
      const orig = (targetCol.cards ?? [])
        .slice()
        .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
      const origIdx = orig.findIndex((c) => c.id === activeId);
      const origBefore = orig[origIdx - 1]?.id ?? null;
      const origAfter = orig[origIdx + 1]?.id ?? null;
      if (
        origBefore === (beforeCard?.id ?? null) &&
        origAfter === (afterCard?.id ?? null)
      ) {
        return;
      }
    }

    updateCard.mutate(
      {
        id: activeId,
        patch: {
          columnId: targetColumnId,
          beforeId: beforeCard?.id ?? null,
          afterId: afterCard?.id ?? null,
        },
      },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not move card.')),
      },
    );
  }

  if (query.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading your board…" />
      </Shell>
    );
  }

  if (query.isError) {
    return (
      <Shell>
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        <div
          data-testid="personal-board"
          className="nl-scroll flex flex-1 gap-0 overflow-x-auto px-4 pb-4 pt-3"
        >
          {columns
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((col, idx) => (
              <div key={col.id} className="flex items-stretch gap-0">
                {idx > 0 && (
                  <div className="nl-lane-divider mx-2" aria-hidden="true" />
                )}
                <PersonalColumn
                  column={col}
                  updateCard={updateCard}
                  deleteCard={deleteCard}
                />
              </div>
            ))}
          <div className="flex items-stretch gap-0">
            {columns.length > 0 && (
              <div className="nl-lane-divider mx-2" aria-hidden="true" />
            )}
            <AddColumnForm />
          </div>
        </div>

        <DragOverlay>
          {activeCard ? (
            <PersonalCardOverlay card={activeCard} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell — page layout with AppHeader
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader />
      <div className="flex items-center justify-between border-b border-ink-100 bg-white px-4 py-2.5">
        <div>
          <h1 className="font-display text-sm font-bold tracking-[-0.01em] text-ink-900">
            My Board
          </h1>
          <p className="text-xs text-ink-400">
            Private scratchpad — visible only to you
          </p>
        </div>
      </div>
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersonalColumn
// ---------------------------------------------------------------------------

function PersonalColumn({
  column,
  updateCard,
  deleteCard,
}: {
  column: PersonalColumnDto;
  updateCard: ReturnType<typeof useUpdatePersonalCard>;
  deleteCard: ReturnType<typeof useDeletePersonalCard>;
}) {
  const toast = useToast();
  const updateColumn = useUpdatePersonalColumn();
  const deleteColumn = useDeletePersonalColumn();

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(column.name);
  const [confirmDeleteCol, setConfirmDeleteCol] = useState(false);
  const [addingCard, setAddingCard] = useState(false);

  const cards = (column.cards ?? [])
    .slice()
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  });

  async function handleRenameSubmit() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === column.name) {
      setRenaming(false);
      setRenameValue(column.name);
      return;
    }
    try {
      await updateColumn.mutateAsync({ id: column.id, patch: { name: trimmed } });
      setRenaming(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not rename column.'));
    }
  }

  async function handleDeleteColumn() {
    try {
      await deleteColumn.mutateAsync(column.id);
      setConfirmDeleteCol(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete column.'));
    }
  }

  return (
    <>
      <div
        data-testid="personal-column"
        data-column-id={column.id}
        className="flex w-72 shrink-0 flex-col rounded-xl border border-ink-200 bg-ink-50 shadow-xs border-t-2 border-t-signal-300"
      >
        {/* Column header */}
        <div className="flex items-center justify-between px-3 py-2.5">
          {renaming ? (
            <form
              className="flex flex-1 items-center gap-1.5 pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                void handleRenameSubmit();
              }}
            >
              <Input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => void handleRenameSubmit()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setRenaming(false);
                    setRenameValue(column.name);
                  }
                }}
                className="h-7 py-0 text-xs font-bold"
                aria-label="Rename column"
              />
            </form>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="h-2 w-2 rounded-full shrink-0 bg-signal-400" aria-hidden="true" />
              <button
                type="button"
                onClick={() => {
                  setRenameValue(column.name);
                  setRenaming(true);
                }}
                className="font-display truncate text-[10px] font-bold uppercase tracking-[0.1em] text-ink-500 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200 rounded"
                aria-label={`Rename column ${column.name}`}
                title="Click to rename"
              >
                {column.name}
              </button>
              <span className="nl-data-chip rounded-sm px-1.5 py-0.5 leading-none bg-ink-200 text-ink-600">
                {cards.length}
              </span>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="personal-add-card"
              onClick={() => setAddingCard(true)}
              aria-label={`Add card to ${column.name}`}
              className="rounded p-1 text-ink-400 transition-colors duration-[120ms] hover:bg-ink-200 hover:text-ink-700"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteCol(true)}
              aria-label={`Delete column ${column.name}`}
              className="rounded p-1 text-ink-400 transition-colors duration-[120ms] hover:bg-red-50 hover:text-red-500"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-6 0V5a1 1 0 011-1h4a1 1 0 011 1v2M9 7H4m16 0h-5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Drop zone */}
        <div
          ref={setNodeRef}
          className={cn(
            'nl-scroll flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2',
            isOver && 'rounded-lg bg-signal-50/70 ring-1 ring-inset ring-signal-300',
          )}
        >
          <SortableContext
            items={cards.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {cards.map((card) => (
              <SortablePersonalCard
                key={card.id}
                card={card}
                updateCard={updateCard}
                deleteCard={deleteCard}
              />
            ))}
          </SortableContext>

          {addingCard && (
            <AddCardComposer
              columnId={column.id}
              onClose={() => setAddingCard(false)}
            />
          )}

          {cards.length === 0 && !addingCard && (
            <button
              type="button"
              onClick={() => setAddingCard(true)}
              aria-label={`Add card to ${column.name}`}
              className="rounded-lg border border-dashed border-ink-300 py-6 text-xs font-medium text-ink-400 transition-all duration-[120ms] hover:border-signal-300 hover:bg-signal-50/40 hover:text-signal-600"
            >
              + Add card
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteCol}
        title="Delete column"
        message={
          <>
            Delete <strong>{column.name}</strong> and all its cards? This
            cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteColumn.isPending}
        onConfirm={() => void handleDeleteColumn()}
        onCancel={() => setConfirmDeleteCol(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// SortablePersonalCard — draggable wrapper
// ---------------------------------------------------------------------------

function SortablePersonalCard({
  card,
  updateCard,
  deleteCard,
}: {
  card: PersonalCardDto;
  updateCard: ReturnType<typeof useUpdatePersonalCard>;
  deleteCard: ReturnType<typeof useDeletePersonalCard>;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card', columnId: card.columnId, card },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab touch-none active:cursor-grabbing motion-safe:nl-card-merge-in"
    >
      <PersonalCard
        card={card}
        dragging={isDragging}
        updateCard={updateCard}
        deleteCard={deleteCard}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersonalCard — the card UI
// ---------------------------------------------------------------------------

function PersonalCard({
  card,
  dragging = false,
  updateCard,
  deleteCard,
}: {
  card: PersonalCardDto;
  dragging?: boolean;
  updateCard: ReturnType<typeof useUpdatePersonalCard>;
  deleteCard: ReturnType<typeof useDeletePersonalCard>;
}) {
  const toast = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);

  // Keyboard-based move: select target column from a small menu.
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const columnsQuery = usePersonalBoard();
  const columns = (columnsQuery.data ?? []).slice().sort((a, b) => a.order - b.order);

  async function handleDelete() {
    try {
      await deleteCard.mutateAsync(card.id);
      setConfirmDelete(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete card.'));
    }
  }

  return (
    <>
      <div
        data-testid="personal-card"
        data-card-id={card.id}
        className={cn(
          'group relative rounded-lg border border-ink-200 bg-white px-3 py-2.5 shadow-xs',
          'transition-shadow duration-[120ms]',
          dragging && 'shadow-cardHover opacity-50 rotate-[0.5deg]',
          !dragging && 'hover:shadow-card',
        )}
      >
        {/* Promoted badge */}
        {card.promotedIssueId && (
          <span className="mb-1.5 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7 7 7M12 3v14" />
            </svg>
            Promoted
          </span>
        )}

        <p
          data-testid="personal-card-title"
          className="text-sm font-medium leading-snug text-ink-900"
        >
          {card.title}
        </p>

        {card.notes && (
          <p className="mt-1 text-xs leading-relaxed text-ink-500 line-clamp-2">
            {card.notes}
          </p>
        )}

        {/* Card actions — shown on hover or focus-within */}
        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100">
          {/* Edit */}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            aria-label="Edit card"
            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>

          {/* Move to column (keyboard-friendly alternative to drag) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoveMenuOpen((v) => !v)}
              aria-label="Move to column"
              aria-haspopup="menu"
              aria-expanded={moveMenuOpen}
              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 9l4-4 4 4M9 5v14M15 15l4 4 4-4M19 19V5" />
              </svg>
            </button>
            {moveMenuOpen && (
              <MoveCardMenu
                card={card}
                columns={columns}
                updateCard={updateCard}
                onClose={() => setMoveMenuOpen(false)}
              />
            )}
          </div>

          {/* Promote */}
          {!card.promotedIssueId && (
            <button
              type="button"
              data-testid="personal-promote"
              onClick={() => setPromoteOpen(true)}
              aria-label="Promote to issue"
              className="rounded p-1 text-ink-400 hover:bg-signal-50 hover:text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7 7 7M12 3v14" />
              </svg>
            </button>
          )}

          {/* Delete */}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete card"
            className="ml-auto rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-6 0V5a1 1 0 011-1h4a1 1 0 011 1v2M9 7H4m16 0h-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Edit modal */}
      <EditCardModal
        open={editOpen}
        card={card}
        onClose={() => setEditOpen(false)}
      />

      {/* Promote modal */}
      <PromoteCardModal
        open={promoteOpen}
        card={card}
        onClose={() => setPromoteOpen(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete card"
        message={
          <>
            Delete <strong>"{card.title}"</strong>? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteCard.isPending}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// MoveCardMenu — keyboard/pointer column picker on the card
// ---------------------------------------------------------------------------

function MoveCardMenu({
  card,
  columns,
  updateCard,
  onClose,
}: {
  card: PersonalCardDto;
  columns: PersonalColumnDto[];
  updateCard: ReturnType<typeof useUpdatePersonalCard>;
  onClose: () => void;
}) {
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (!ref.current?.contains(e.relatedTarget as Node)) onClose();
    },
    [onClose],
  );

  async function moveTo(targetCol: PersonalColumnDto) {
    if (targetCol.id === card.columnId) {
      onClose();
      return;
    }
    const sortedCards = (targetCol.cards ?? [])
      .slice()
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    const lastCard = sortedCards[sortedCards.length - 1] ?? null;
    try {
      await updateCard.mutateAsync({
        id: card.id,
        patch: {
          columnId: targetCol.id,
          beforeId: lastCard?.id ?? null,
          afterId: null,
        },
      });
    } catch (err) {
      toast.error(errorMessage(err, 'Could not move card.'));
    }
    onClose();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Move card to column"
      onBlur={handleBlur}
      className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-ink-200 bg-white py-1 shadow-dropdown"
    >
      {columns.map((col) => (
        <button
          key={col.id}
          type="button"
          role="menuitem"
          onClick={() => void moveTo(col)}
          disabled={col.id === card.columnId}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
            col.id === card.columnId
              ? 'cursor-default text-ink-300'
              : 'text-ink-700 hover:bg-ink-50 hover:text-ink-900 focus:outline-none focus-visible:bg-ink-50',
          )}
        >
          {col.id === card.columnId && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {col.name}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddCardComposer — inline card creation within a column
// ---------------------------------------------------------------------------

function AddCardComposer({
  columnId,
  onClose,
}: {
  columnId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const createCard = useCreatePersonalCard();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    try {
      await createCard.mutateAsync({ columnId, title: trimmed });
      setTitle('');
      // Keep composer open so user can add more cards quickly.
      inputRef.current?.focus();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not add card.'));
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-lg border border-signal-300 bg-white p-2 shadow-xs"
    >
      <input
        ref={inputRef}
        autoFocus
        type="text"
        data-testid="personal-add-card-input"
        placeholder="Card title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="w-full rounded border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-signal-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200"
        aria-label="New card title"
      />
      <div className="mt-2 flex items-center gap-1.5">
        <Button
          type="submit"
          size="sm"
          loading={createCard.isPending}
          disabled={!title.trim()}
          data-testid="personal-card-save"
        >
          Add card
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// EditCardModal
// ---------------------------------------------------------------------------

function EditCardModal({
  open,
  card,
  onClose,
}: {
  open: boolean;
  card: PersonalCardDto;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes ?? '');
  const updateCard = useUpdatePersonalCard();
  const toast = useToast();

  // Reset local state when card prop changes (e.g. after a save).
  const prevCardId = useRef(card.id);
  if (prevCardId.current !== card.id) {
    prevCardId.current = card.id;
    setTitle(card.title);
    setNotes(card.notes ?? '');
  }

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    try {
      await updateCard.mutateAsync({
        id: card.id,
        patch: {
          title: trimmedTitle,
          notes: notes.trim() || null,
        },
      });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save card.'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit card"
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={updateCard.isPending}
            disabled={!title.trim()}
            onClick={() => void handleSave()}
            data-testid="personal-card-save"
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label
            htmlFor="edit-card-title"
            className="mb-1 block text-xs font-medium text-ink-700"
          >
            Title
          </label>
          <Input
            id="edit-card-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
          />
        </div>
        <div>
          <label
            htmlFor="edit-card-notes"
            className="mb-1 block text-xs font-medium text-ink-700"
          >
            Notes
          </label>
          <Textarea
            id="edit-card-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
            rows={3}
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// PromoteCardModal — project picker + promote action
// ---------------------------------------------------------------------------

function PromoteCardModal({
  open,
  card,
  onClose,
}: {
  open: boolean;
  card: PersonalCardDto;
  onClose: () => void;
}) {
  const toast = useToast();
  const promote = usePromotePersonalCard();
  const workspacesQuery = useWorkspaces();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const workspaces = workspacesQuery.data ?? [];

  // Pick first workspace by default once loaded.
  const effectiveWorkspaceId =
    selectedWorkspaceId || workspaces[0]?.id || '';

  const projectsQuery = useProjects(effectiveWorkspaceId || undefined);
  const projects = projectsQuery.data ?? [];

  const effectiveProjectId = selectedProjectId || projects[0]?.id || '';

  async function handlePromote() {
    if (!effectiveProjectId) {
      toast.error('Please select a project.');
      return;
    }
    try {
      const result = await promote.mutateAsync({
        id: card.id,
        projectId: effectiveProjectId,
      });
      toast.success(
        `Promoted to issue ${result.issue.key}`,
        {
          title: 'Issue created',
        },
      );
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not promote card.'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Promote to issue"
      size="max-w-sm"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={promote.isPending}
            disabled={!effectiveProjectId}
            onClick={() => void handlePromote()}
          >
            Promote
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-600">
          Create a real issue from{' '}
          <strong className="text-ink-900">"{card.title}"</strong> in the
          selected project.
        </p>

        {workspacesQuery.isLoading ? (
          <p className="text-xs text-ink-400">Loading workspaces…</p>
        ) : workspaces.length === 0 ? (
          <p className="text-xs text-ink-400">No workspaces found.</p>
        ) : (
          <>
            {workspaces.length > 1 && (
              <div>
                <label
                  htmlFor="promote-workspace"
                  className="mb-1 block text-xs font-medium text-ink-700"
                >
                  Workspace
                </label>
                <Select
                  id="promote-workspace"
                  value={effectiveWorkspaceId}
                  onChange={(e) => {
                    setSelectedWorkspaceId(e.target.value);
                    setSelectedProjectId('');
                  }}
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <label
                htmlFor="promote-project"
                className="mb-1 block text-xs font-medium text-ink-700"
              >
                Project
              </label>
              {projectsQuery.isLoading ? (
                <p className="text-xs text-ink-400">Loading projects…</p>
              ) : projects.length === 0 ? (
                <p className="text-xs text-ink-400">
                  No projects in this workspace.{' '}
                  <Link to="/" className="text-signal-600 hover:underline">
                    Create one first.
                  </Link>
                </p>
              ) : (
                <Select
                  id="promote-project"
                  value={effectiveProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.key}] {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// AddColumnForm — inline form at the end of the board
// ---------------------------------------------------------------------------

function AddColumnForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const createColumn = useCreatePersonalColumn();
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createColumn.mutateAsync({ name: trimmed });
      setName('');
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not add column.'));
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="personal-add-column"
        onClick={() => setOpen(true)}
        className={cn(
          'flex h-fit w-64 shrink-0 items-center gap-2 rounded-xl border border-dashed border-ink-300',
          'px-4 py-3 text-sm font-medium text-ink-400',
          'transition-all duration-[120ms] hover:border-signal-300 hover:bg-signal-50/40 hover:text-signal-600',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-200',
        )}
        aria-label="Add a new column"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        Add column
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="w-64 shrink-0 rounded-xl border border-signal-300 bg-ink-50 p-3 shadow-xs"
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setName('');
          }
        }}
        placeholder="Column name…"
        aria-label="New column name"
        className="mb-2"
      />
      <div className="flex gap-1.5">
        <Button
          type="submit"
          size="sm"
          loading={createColumn.isPending}
          disabled={!name.trim()}
        >
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setName('');
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// PersonalCardOverlay — lightweight clone for the DragOverlay
// ---------------------------------------------------------------------------

function PersonalCardOverlay({ card }: { card: PersonalCardDto }) {
  return (
    <div className="w-72 rounded-lg border border-ink-200 bg-white px-3 py-2.5 shadow-cardHover rotate-[1deg]">
      {card.promotedIssueId && (
        <span className="mb-1.5 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
          Promoted
        </span>
      )}
      <p className="text-sm font-medium text-ink-900">{card.title}</p>
      {card.notes && (
        <p className="mt-1 text-xs text-ink-500 line-clamp-2">{card.notes}</p>
      )}
    </div>
  );
}

// Re-export usePersonalBoard from the hook (used by PersonalCard's move menu)
// via the import already at the top of the file — no extra export needed here.
