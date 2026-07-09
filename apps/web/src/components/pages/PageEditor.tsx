/**
 * PageEditor — read/edit surface for a single page's title + markdown body.
 *
 * Read mode renders via `PageContent` (wiki-link-aware markdown). Edit mode
 * swaps in a title `Input` + `WikiLinkTextarea` with Save/Cancel actions —
 * an explicit mode toggle (not click-to-edit like the issue description)
 * because a page is a longer-form document worth a deliberate "I'm editing
 * this now" state, with its own toolbar (unresolved-link count, Save/Cancel).
 *
 * PATCH on Save snapshots a new `PageVersion` server-side automatically
 * (see `UpdatePageDto`) — this component doesn't manage version history
 * itself, see `VersionHistoryDrawer`.
 */
import { useEffect, useRef, useState } from 'react';
import type { PageDto } from '@next-lane/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { countUnresolvedWikiLinks, type FlatPageOption } from '@/lib/wikiLinks';
import { PageContent } from './PageContent';
import { WikiLinkTextarea } from './WikiLinkTextarea';

export interface PageEditorProps {
  page: PageDto;
  titleIndex: Map<string, string>;
  pageOptions: FlatPageOption[];
  editable: boolean;
  saving: boolean;
  onSave: (patch: { title: string; content: string }) => Promise<unknown>;
  onOpenPage: (pageId: string) => void;
  onCreatePage: (title: string) => void;
  /** Fires when edit mode toggles — lets the parent hide sidecar panels for full-page editing. */
  onEditingChange?: (editing: boolean) => void;
}

export function PageEditor({
  page,
  titleIndex,
  pageOptions,
  editable,
  saving,
  onSave,
  onOpenPage,
  onCreatePage,
  onEditingChange,
}: PageEditorProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  // Let the parent react to edit mode (hide backlinks etc. for a full-page
  // editing canvas). Effect-based so every transition path (edit button,
  // cancel, save, page navigation reset) is covered.
  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState(page.content);

  // Reset the draft whenever a DIFFERENT page loads — always, even if we
  // happened to be mid-edit (you can't still be editing a page you've
  // navigated away from).
  useEffect(() => {
    setTitle(page.title);
    setContent(page.content);
    setEditing(false);
  }, [page.id]);

  // Re-sync the READ-mode draft from the live `page` prop whenever its
  // title/content changes from OUTSIDE this component — a version restore,
  // or another tab/user's edit arriving via realtime. Deliberately does
  // NOT depend on `editing`: this only needs to react to the page's data
  // changing; toggling edit mode alone is already handled directly by
  // `handleCancel`/`handleSave`. The `if (editing) return` guard still
  // reads the current value each time this DOES run, so an edit in
  // progress is never clobbered.
  useEffect(() => {
    if (editing) return;
    setTitle(page.title);
    setContent(page.content);
  }, [page.title, page.content]);

  const dirty = editing && (title !== page.title || content !== page.content);
  const unresolvedCount = editing ? countUnresolvedWikiLinks(content, titleIndex) : 0;

  // Synchronous in-flight guard: the `saving` prop reflects the mutation's
  // async state, which hasn't flipped yet when a fast double-click fires two
  // clicks in the same tick — both would PATCH and create a duplicate version.
  // A ref set synchronously blocks the second one.
  const savingRef = useRef(false);

  async function handleSave() {
    if (savingRef.current) return;
    if (!title.trim()) {
      toast.error('Page title can’t be empty.');
      return;
    }
    savingRef.current = true;
    try {
      await onSave({ title: title.trim(), content });
      setEditing(false);
      toast.success('Page saved.');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the page.'));
    } finally {
      savingRef.current = false;
    }
  }

  function handleCancel() {
    setTitle(page.title);
    setContent(page.content);
    setEditing(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Document header — title + actions, constrained to the same centered
          reading column as the body so the whole surface reads as one page. */}
      <div className="border-b border-ink-100 px-4 py-3 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-3">
        {editing ? (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            aria-label="Page title"
            data-testid="page-title-input"
            className="h-auto flex-1 border-none bg-transparent px-0 font-display text-2xl font-semibold text-ink-900 shadow-none focus:ring-0"
          />
        ) : (
          <h1
            data-testid="page-title"
            className="min-w-0 flex-1 font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 sm:text-3xl"
          >
            {page.title}
          </h1>
        )}

        {editable && (
          <div className="flex shrink-0 items-center gap-2">
            {editing ? (
              <>
                {unresolvedCount > 0 && (
                  <span
                    data-testid="page-unresolved-links"
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200"
                    title="These [[links]] don't match a page yet — they'll render as a create-it affordance."
                    aria-label={`${unresolvedCount} unresolved link${unresolvedCount === 1 ? '' : 's'}`}
                  >
                    {unresolvedCount}
                    <span className="hidden sm:inline">
                      &nbsp;unresolved link{unresolvedCount === 1 ? '' : 's'}
                    </span>
                  </span>
                )}
                <Button variant="secondary" size="sm" onClick={handleCancel} data-testid="page-cancel-edit">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  loading={saving}
                  disabled={!dirty || saving}
                  data-testid="page-save"
                >
                  Save
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(true)}
                data-testid="page-edit"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
                </svg>
                Edit
              </Button>
            )}
          </div>
        )}
        </div>
      </div>

      {editing ? (
        /* Full-page editing canvas: the textarea fills every pixel down to
           the bottom of the pane (it scrolls internally), borderless inside
           the same centered column — writing on the page, not in a box. */
        <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-8">
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
            <WikiLinkTextarea
              value={content}
              onChange={setContent}
              pages={pageOptions}
              aria-label="Page content (Markdown, use [[ to link another page)"
              placeholder="Write in Markdown… type [[ to link another page."
              data-testid="page-content-editor"
              className="min-h-[50vh] flex-1 resize-none border-none bg-transparent px-0 shadow-none focus:ring-0"
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto w-full max-w-3xl">
            {content ? (
              <PageContent
                content={content}
                titleIndex={titleIndex}
                onOpenPage={onOpenPage}
                onCreatePage={onCreatePage}
                className="max-w-none"
              />
            ) : (
              <p data-testid="page-content-empty" className="text-sm text-ink-400">
                {editable ? 'This page is empty. Click Edit to start writing.' : 'This page is empty.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
