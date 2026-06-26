import { useEffect, useState, type FormEvent } from 'react';
import {
  ISSUE_TYPES,
  PRIORITIES,
  IssueType,
  Priority,
  type StatusDto,
  type UserDto,
} from '@next-lane/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Field } from '@/components/ui/Field';
import { useCreateIssue } from '@/api/issues';
import { ApiError } from '@/api/client';
import { useToast } from '@/components/ui/Toast';
import { titleCase } from '@/components/issue/issueMeta';

export function CreateIssueModal({
  open,
  onClose,
  projectId,
  statuses,
  users,
  defaultStatusId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  statuses: StatusDto[];
  users: UserDto[];
  defaultStatusId?: string;
}) {
  const create = useCreateIssue(projectId);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<IssueType>(IssueType.TASK);
  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [statusId, setStatusId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatusId(defaultStatusId ?? statuses[0]?.id ?? '');
    }
  }, [open, defaultStatusId, statuses]);

  function reset() {
    setTitle('');
    setDescription('');
    setType(IssueType.TASK);
    setPriority(Priority.MEDIUM);
    setAssigneeId('');
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
      const issue = await create.mutateAsync({
        projectId,
        title: title.trim(),
        type,
        priority,
        statusId: statusId || undefined,
        assigneeId: assigneeId || null,
        description: description.trim() || undefined,
      });
      reset();
      onClose();
      toast.success(`Created ${issue.key}.`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not create issue.';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create issue"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-issue-form"
            loading={create.isPending}
            disabled={!title.trim()}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="create-issue-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Title" htmlFor="issue-title">
          <Input
            id="issue-title"
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
          />
        </Field>
        <Field label="Description" htmlFor="issue-desc">
          <Textarea
            id="issue-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add more detail…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="issue-type">
            <Select
              id="issue-type"
              value={type}
              onChange={(e) => setType(e.target.value as IssueType)}
            >
              {ISSUE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="issue-priority">
            <Select
              id="issue-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {titleCase(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="issue-status">
            <Select
              id="issue-status"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assignee" htmlFor="issue-assignee">
            <Select
              id="issue-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
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
