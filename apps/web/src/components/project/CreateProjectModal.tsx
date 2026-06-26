import { useState, type FormEvent } from 'react';
import type { ProjectDto } from '@next-lane/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { useCreateProject } from '@/api/projects';
import { ApiError } from '@/api/client';
import { useToast } from '@/components/ui/Toast';

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
      setKey(
        value
          .replace(/[^a-zA-Z]/g, '')
          .slice(0, 5)
          .toUpperCase(),
      );
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
            disabled={!name.trim() || !key.trim()}
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
          hint="Short prefix used in issue keys, e.g. MOB-12."
        >
          <Input
            id="project-key"
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
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
