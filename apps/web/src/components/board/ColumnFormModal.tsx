import { useEffect, useState, type FormEvent } from 'react';
import {
  STATUS_CATEGORIES,
  StatusCategory,
  type StatusDto,
} from '@next-lane/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { useCreateStatus, useUpdateStatus } from '@/api/statuses';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

/** Human-readable labels for the status category select. */
const CATEGORY_LABEL: Record<StatusCategory, string> = {
  [StatusCategory.TODO]: 'To Do',
  [StatusCategory.IN_PROGRESS]: 'In Progress',
  [StatusCategory.DONE]: 'Done',
};

/**
 * Add or rename a board column (status). When `status` is provided the form
 * edits that column; otherwise it creates a new one (appended to the end). The
 * category controls DONE semantics used by reports and sprint completion, so it
 * is always editable here.
 */
export function ColumnFormModal({
  open,
  onClose,
  projectId,
  status,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** When set, edit this column; when omitted, create a new column. */
  status?: StatusDto;
}) {
  const isEdit = !!status;
  const createStatus = useCreateStatus(projectId);
  const updateStatus = useUpdateStatus(projectId);
  const toast = useToast();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>(StatusCategory.TODO);
  /** Raw string for the WIP limit input — empty means no limit. */
  const [wipLimitRaw, setWipLimitRaw] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Seed the form whenever it opens (or the target column changes).
  useEffect(() => {
    if (!open) return;
    setName(status?.name ?? '');
    setCategory(status?.category ?? StatusCategory.TODO);
    setWipLimitRaw(status?.wipLimit != null ? String(status.wipLimit) : '');
    setError(null);
  }, [open, status]);

  const pending = createStatus.isPending || updateStatus.isPending;

  function handleClose() {
    setError(null);
    onClose();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);

    // Parse WIP limit: empty → null (no limit), positive integer → number.
    const rawTrimmed = wipLimitRaw.trim();
    let wipLimit: number | null = null;
    if (rawTrimmed !== '') {
      const parsed = parseInt(rawTrimmed, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        const msg = 'WIP limit must be a positive integer (1 or more).';
        setError(msg);
        toast.error(msg);
        return;
      }
      wipLimit = parsed;
    }

    try {
      if (isEdit && status) {
        await updateStatus.mutateAsync({ id: status.id, name: trimmed, category, wipLimit });
        toast.success(`Updated "${trimmed}".`);
      } else {
        await createStatus.mutateAsync({ name: trimmed, category, wipLimit });
        toast.success(`Added column "${trimmed}".`);
      }
      handleClose();
    } catch (err) {
      const message = errorMessage(
        err,
        isEdit ? 'Could not update the column.' : 'Could not add the column.',
      );
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? 'Edit column' : 'Add column'}
      size="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="column-form"
            loading={pending}
            disabled={!name.trim()}
          >
            {isEdit ? 'Save' : 'Add column'}
          </Button>
        </>
      }
    >
      <form id="column-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="column-name">
          <Input
            id="column-name"
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. In Review"
          />
        </Field>
        <Field
          label="Category"
          htmlFor="column-category"
          hint="Cards in a Done column count as completed in reports and sprints."
        >
          <Select
            id="column-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as StatusCategory)}
          >
            {STATUS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="WIP limit (optional)"
          htmlFor="column-wip-limit"
          hint="Maximum number of issues allowed in this column. Leave blank for no limit."
        >
          <Input
            id="column-wip-limit"
            data-testid="column-wip-limit-input"
            type="number"
            min={1}
            step={1}
            value={wipLimitRaw}
            onChange={(e) => setWipLimitRaw(e.target.value)}
            placeholder="e.g. 5"
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
