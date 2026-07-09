import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [open, initialTitle]);

  // `[ ] |` are reserved for the [[wiki-link]] grammar; a title containing
  // them can't be linked to, so the API rejects it. Flag it inline instead of
  // letting the user hit a round-trip 400.
  const hasReservedChar = /[[\]|]/.test(title);
  const canSubmit = title.trim().length > 0 && !hasReservedChar;

  function submit() {
    const trimmed = title.trim();
    if (!trimmed || hasReservedChar) return;
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
