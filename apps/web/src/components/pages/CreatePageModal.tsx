import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { renderPageTemplate, type PageTemplateDto } from '@next-lane/shared';
import { cn } from '@/lib/cn';

/** The "no template" sentinel — a blank page, the pre-template behaviour. */
export const BLANK_TEMPLATE_ID = '';

export interface CreatePageModalProps {
  open: boolean;
  /** When set, this is a "new child page" — shown for context. */
  parentTitle?: string;
  /** Pre-filled title (e.g. from clicking an unresolved `[[wiki-link]]`). */
  initialTitle?: string;
  loading: boolean;
  /**
   * Templates offered for this scope. Omitted/empty hides the picker entirely,
   * so the modal degrades to exactly its pre-template form.
   */
  templates?: PageTemplateDto[];
  /**
   * `templateId` is `BLANK_TEMPLATE_ID` for a blank page, otherwise the chosen
   * template — the caller routes to the template endpoint in that case.
   */
  onCreate: (title: string, templateId: string) => void;
  onClose: () => void;
}

export function CreatePageModal({
  open,
  parentTitle,
  initialTitle = '',
  loading,
  templates,
  onCreate,
  onClose,
}: CreatePageModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [templateId, setTemplateId] = useState<string>(BLANK_TEMPLATE_ID);
  // Set once the user edits the title by hand, so switching template never
  // clobbers something they typed. Without it, picking a template after typing
  // would silently discard their title.
  const [titleDirty, setTitleDirty] = useState(false);
  // Synchronous in-flight guard: `loading` reflects the async mutation state,
  // which hasn't flipped when a fast double-click fires two clicks in the same
  // tick — both would POST and create duplicate pages. Reset each time the
  // modal (re)opens.
  const submittingRef = useRef(false);

  const hasTemplates = (templates?.length ?? 0) > 0;
  const selected = useMemo(
    () => templates?.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  // Reset the draft DURING RENDER whenever the modal (re)opens — deliberately
  // NOT in a `useEffect`.
  //
  // This component stays mounted while closed (`Modal` renders null), so
  // `title` survives from the previous session. Resetting it post-commit meant
  // a reopened modal COMMITTED one render carrying the PREVIOUS page's title
  // into the real <input>, with `autoFocus` parking the caret at offset 0. The
  // reset only landed on a later, normal-priority render — and a keystroke
  // arriving inside that window wins, because `onChange` reads the stale DOM
  // value and its higher-priority update supersedes the pending reset. The
  // result was a spliced title: typing "Other Doc" over a leftover "Draft Doc"
  // persisted a page actually named "Other DocDraft Doc".
  //
  // Adjusting state during render makes React re-run this component
  // immediately, before it touches the DOM, so the stale value is never
  // observable to a user, a keystroke, or a test.
  // See https://react.dev/reference/react/useState#storing-information-from-previous-renders
  //
  // The template selection is reset here too, and for the same reason: a
  // reopened modal must not silently carry the last page's template.
  const [lastSeen, setLastSeen] = useState({ open, initialTitle });
  if (lastSeen.open !== open || lastSeen.initialTitle !== initialTitle) {
    setLastSeen({ open, initialTitle });
    if (open) {
      setTitle(initialTitle);
      setTemplateId(BLANK_TEMPLATE_ID);
      setTitleDirty(initialTitle.length > 0);
      submittingRef.current = false;
    }
  }

  // Release the guard once the create settles (success closes the modal; a
  // failure keeps it open, and the user must be able to retry).
  useEffect(() => {
    if (!loading) submittingRef.current = false;
  }, [loading]);

  // `[ ] |` are reserved for the [[wiki-link]] grammar; a title containing
  // them can't be linked to, so the API rejects it. Flag it inline instead of
  // letting the user hit a round-trip 400.
  const hasReservedChar = /[[\]|]/.test(title);
  const canSubmit = title.trim().length > 0 && !hasReservedChar;

  /**
   * Pick a template, and adopt its title suggestion when the user hasn't typed
   * one. The suggestion is rendered client-side purely as a PREVIEW — the
   * server re-renders authoritatively from the stored template, so a stale
   * clock here can never persist a wrong value.
   */
  function chooseTemplate(next: string) {
    setTemplateId(next);
    if (titleDirty) return;
    const tpl = templates?.find((t) => t.id === next) ?? null;
    setTitle(
      tpl?.titleTemplate
        ? renderPageTemplate(tpl.titleTemplate, {
            title: '',
            author: '',
            now: new Date(),
          }).trim()
        : '',
    );
  }

  function submit() {
    if (submittingRef.current) return;
    const trimmed = title.trim();
    if (!trimmed || hasReservedChar) return;
    submittingRef.current = true;
    onCreate(trimmed, templateId);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parentTitle ? `New page under "${parentTitle}"` : 'New page'}
      size={hasTemplates ? 'max-w-md' : 'max-w-sm'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={loading} disabled={!canSubmit} data-testid="create-page-submit">
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <Field
          label="Title"
          htmlFor="new-page-title"
          error={hasReservedChar ? 'Titles can’t contain [ ] or | — they’re reserved for [[wiki-links]].' : undefined}
        >
          <Input
            id="new-page-title"
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleDirty(true);
            }}
            placeholder="Page title"
            aria-invalid={hasReservedChar}
            data-testid="create-page-title-input"
          />
        </Field>

        {hasTemplates && (
          <Field label="Start from" htmlFor="new-page-template">
            <div
              id="new-page-template"
              role="radiogroup"
              aria-label="Start from"
              // `grid-cols-1`, not a bare `grid`: an implicit grid column is
              // sized `auto` (max-content), so a long description pushed the
              // rows WIDER than the modal and clipped them mid-word instead of
              // ellipsising — badly on mobile. `grid-cols-1` is
              // `repeat(1, minmax(0, 1fr))`, which constrains to the container
              // and lets the inner `truncate` actually do its job.
              className="grid grid-cols-1 gap-1.5"
              data-testid="create-page-template-picker"
            >
              <TemplateOption
                name="Blank page"
                description="An empty document."
                selected={templateId === BLANK_TEMPLATE_ID}
                onSelect={() => chooseTemplate(BLANK_TEMPLATE_ID)}
                testId="create-page-template-blank"
              />
              {templates!.map((t) => (
                <TemplateOption
                  key={t.id}
                  name={t.name}
                  description={t.description ?? undefined}
                  // A project template is the more specific answer and is
                  // listed first; the badge makes the distinction legible
                  // when both scopes define the same name.
                  scopeLabel={t.projectId === null ? 'Workspace' : 'Project'}
                  selected={templateId === t.id}
                  onSelect={() => chooseTemplate(t.id)}
                  testId={`create-page-template-${t.id}`}
                />
              ))}
            </div>
          </Field>
        )}

        {selected && (
          <p className="text-xs text-ink-500" data-testid="create-page-template-hint">
            Placeholders like <code className="font-mono">{'{{date}}'}</code> are filled in
            when the page is created.
          </p>
        )}
      </form>
    </Modal>
  );
}

function TemplateOption({
  name,
  description,
  scopeLabel,
  selected,
  onSelect,
  testId,
}: {
  name: string;
  description?: string;
  scopeLabel?: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'flex w-full min-w-0 items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1',
        selected
          ? 'border-signal-300 bg-signal-50 ring-1 ring-inset ring-signal-100'
          : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-[3px] h-3.5 w-3.5 shrink-0 rounded-full border',
          selected ? 'border-[4px] border-signal-500' : 'border-ink-300',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink-900">{name}</span>
          {scopeLabel && (
            <span className="shrink-0 rounded px-1 py-px text-[10px] font-medium uppercase tracking-wide text-ink-500 ring-1 ring-inset ring-ink-200">
              {scopeLabel}
            </span>
          )}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-ink-500">{description}</span>
        )}
      </span>
    </button>
  );
}
