import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';

export interface CreatePageModalProps {
  open: boolean;
  /** When set, this is a "new child page" — shown for context. */
  parentTitle?: string;
  /** Pre-filled title (e.g. from clicking an unresolved `[[wiki-link]]`). */
  initialTitle?: string;
  loading: boolean;
  onCreate: (title: string) => void;
  onClose: () => void;
}

export function CreatePageModal({
  open,
  parentTitle,
  initialTitle = '',
  loading,
  onCreate,
  onClose,
}: CreatePageModalProps) {
  const [title, setTitle] = useState(initialTitle);
  // Synchronous in-flight guard: `loading` reflects the async mutation state,
  // which hasn't flipped when a fast double-click fires two clicks in the same
  // tick — both would POST and create duplicate pages. Reset each time the
  // modal (re)opens.
  const submittingRef = useRef(false);

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
  const [lastSeen, setLastSeen] = useState({ open, initialTitle });
  if (lastSeen.open !== open || lastSeen.initialTitle !== initialTitle) {
    setLastSeen({ open, initialTitle });
    if (open) {
      setTitle(initialTitle);
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

  function submit() {
    if (submittingRef.current) return;
    const trimmed = title.trim();
    if (!trimmed || hasReservedChar) return;
    submittingRef.current = true;
    onCreate(trimmed);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parentTitle ? `New page under "${parentTitle}"` : 'New page'}
      size="max-w-sm"
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
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            aria-invalid={hasReservedChar}
            data-testid="create-page-title-input"
          />
        </Field>
      </form>
    </Modal>
  );
}
