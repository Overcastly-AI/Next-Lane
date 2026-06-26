import { useState, type FormEvent } from 'react';
import type { WorkspaceDto } from '@next-lane/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { useCreateWorkspace } from '@/api/workspaces';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

export function CreateWorkspaceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (workspace: WorkspaceDto) => void;
}) {
  const create = useCreateWorkspace();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const workspace = await create.mutateAsync({ name: name.trim() });
      reset();
      onCreated(workspace);
      toast.success(`Created workspace ${workspace.name}.`);
    } catch (err) {
      const message = errorMessage(err, 'Could not create workspace.');
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New workspace"
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-workspace-form"
            loading={create.isPending}
            disabled={!name.trim()}
          >
            Create workspace
          </Button>
        </>
      }
    >
      <form id="create-workspace-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="workspace-name">
          <Input
            id="workspace-name"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Workspace"
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
