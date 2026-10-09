import { useState, type FormEvent } from 'react';
import type { ProjectDto } from '@next-lane/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { useCreateProject } from '@/api/projects';
import { ApiError } from '@/api/client';
import { useToast } from '@/components/ui/Toast';

/**
 * Derive a project key from a name: initials for multi-word names
 * ("Mobile App" -> MA), the first four letters for a single word
 * ("Mobile" -> MOBI). Letters only; capped at 5.
 */
export function deriveProjectKey(name: string): string {
  const words = name.match(/[A-Za-z]+/g) ?? [];
  if (words.length === 0) return '';
  const raw =
    words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join('');
  return raw.slice(0, 5).toUpperCase();
}

/**
 * Mirror of the API's key rule: starts with a letter, 2-10 letters/digits.
 * Returns a human message, or null when valid (or still empty — emptiness is
 * handled by the disabled submit, not by shouting at an untouched field).
 */
export function projectKeyError(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (!/^[A-Za-z]/.test(k)) return 'Key must start with a letter.';
  if (k.length < 2) return 'Key must be at least 2 characters.';
  if (k.length > 10) return 'Key must be at most 10 characters.';
  if (!/^[A-Za-z0-9]+$/.test(k)) return 'Key can only contain letters and numbers.';
  return null;
}

export function CreateProjectModal({
  open,
  onClose,
  workspaceId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  onCreated: (project: ProjectDto) => void;
}) {
  const create = useCreateProject();
  const toast = useToast();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setKey('');
    setKeyTouched(false);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Auto-derive a key from the name until the user edits it manually.
  function onNameChange(value: string) {
    setName(value);
    if (!keyTouched) {
      setKey(deriveProjectKey(value));
    }
  }

  const keyError = projectKeyError(key);
  const keyInvalid = !key.trim() || keyError !== null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (keyInvalid) return;
    setError(null);
    try {
      const project = await create.mutateAsync({
        workspaceId,
        name: name.trim(),
        key: key.trim().toUpperCase(),
      });
      reset();
      onCreated(project);
      toast.success(`Created project ${project.name}.`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not create project.';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New project"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} type="button">
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-project-form"
            loading={create.isPending}
            disabled={!name.trim() || keyInvalid}
          >
            Create project
          </Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="project-name">
          <Input
            id="project-name"
            autoFocus
            required
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Mobile App"
          />
        </Field>
        <Field
          label="Key"
          htmlFor="project-key"
          error={keyError ?? undefined}
          hint={
            keyTouched
              ? 'Short prefix used in issue keys. Edited by hand.'
              : 'Short prefix used in issue keys. Follows the name until you edit it.'
          }
        >
          <Input
            id="project-key"
            aria-invalid={keyError ? true : undefined}
            required
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            }}
            placeholder="MOB"
            maxLength={10}
          />
        </Field>
        <div
          data-testid="project-identity-preview"
          className="flex items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5"
        >
          <span
            aria-hidden="true"
            className="rounded border border-signal-100 bg-signal-50 px-2 py-0.5 font-mono text-xs font-semibold tracking-wide text-signal-700"
          >
            {key || '···'}
          </span>
          <span className="min-w-0 text-sm">
            <span className="block truncate font-semibold text-ink-900">
              {name.trim() || 'Your project'}
            </span>
            <span className="block font-mono text-xs text-ink-600">
              Issues will be {key || 'KEY'}-1, {key || 'KEY'}-2, …
            </span>
          </span>
        </div>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
