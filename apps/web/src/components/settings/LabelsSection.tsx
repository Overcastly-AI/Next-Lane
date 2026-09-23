import { useState, type FormEvent } from 'react';
import { useLabels } from '@/api/meta';
import { useCreateLabel, useDeleteLabel, useUpdateLabel } from '@/api/labels';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import { SettingsSection } from './SettingsSection';
import { IconButton } from './IconButton';

/** On-brand swatches offered when creating a new label (mirrors LabelPicker). */
const SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
];

/* ------------------------------------------------------------------- labels */

/** Inline edit form for a single existing label (name + color swatch). */
function EditLabelForm({
  label,
  projectId,
  onDone,
}: {
  label: { id: string; name: string; color: string };
  projectId: string;
  onDone: () => void;
}) {
  const updateLabel = useUpdateLabel(projectId);
  const toast = useToast();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(
    SWATCHES.includes(label.color) ? label.color : SWATCHES[5],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    updateLabel.mutate(
      { labelId: label.id, input: { name: trimmed, color } },
      {
        onSuccess: () => {
          toast.success('Label updated.');
          onDone();
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update the label.')),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2"
      data-testid="edit-label-form"
    >
      <div className="min-w-[10rem] flex-1">
        <Input
          autoFocus
          value={name}
          aria-label="Label name"
          onChange={(e) => setName(e.target.value)}
          placeholder="Label name"
          maxLength={50}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onDone();
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pb-1">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Color ${s}`}
            aria-pressed={s === color}
            onClick={() => setColor(s)}
            style={{ backgroundColor: s }}
            className={cn(
              'h-5 w-5 rounded-full transition-transform focus:outline-none',
              s === color
                ? 'ring-2 ring-slate-900 ring-offset-1'
                : 'hover:scale-110',
            )}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 pb-1">
        <Button variant="ghost" size="sm" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          type="submit"
          loading={updateLabel.isPending}
          disabled={!name.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

export function LabelsSection({
  projectId,
  editable,
  isAdmin,
}: {
  projectId: string;
  editable: boolean;
  isAdmin: boolean;
}) {
  const labelsQuery = useLabels(projectId);
  const createLabel = useCreateLabel(projectId);
  const deleteLabel = useDeleteLabel(projectId);
  const toast = useToast();

  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[5]);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const labels = labelsQuery.data ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createLabel.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          toast.success('Label created.');
          setName('');
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not create the label.')),
      },
    );
  }

  return (
    <SettingsSection
      title="Labels"
      description="Labels can be attached to issues to categorize work."
    >
      {labels.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">No labels yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {labels.map((label) =>
            editingId === label.id ? (
              <li key={label.id}>
                <EditLabelForm
                  label={label}
                  projectId={projectId}
                  onDone={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li
                key={label.id}
                className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                data-testid="settings-label-row"
              >
                <Badge color={label.color}>{label.name}</Badge>
                <span className="flex-1" />
                {editable && (
                  <IconButton
                    aria-label={`Edit label ${label.name}`}
                    onClick={() => setEditingId(label.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </IconButton>
                )}
                {editable && isAdmin && (
                  <IconButton
                    aria-label={`Delete label ${label.name}`}
                    danger
                    onClick={() =>
                      setPendingDelete({ id: label.id, name: label.name })
                    }
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                    </svg>
                  </IconButton>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {editable && (
        <form
          onSubmit={submit}
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
        >
          <div className="min-w-[12rem] flex-1">
            <Field label="New label" htmlFor="settings-label-name">
              <Input
                id="settings-label-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Label name"
                maxLength={40}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pb-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Color ${s}`}
                aria-pressed={s === color}
                onClick={() => setColor(s)}
                style={{ backgroundColor: s }}
                className={cn(
                  'h-5 w-5 rounded-full transition-transform focus:outline-none',
                  s === color
                    ? 'ring-2 ring-slate-900 ring-offset-1'
                    : 'hover:scale-110',
                )}
              />
            ))}
          </div>
          <Button
            type="submit"
            loading={createLabel.isPending}
            disabled={!name.trim()}
          >
            Add label
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete label"
        message={
          <>
            Delete the label{' '}
            <span className="font-medium text-slate-900">
              {pendingDelete?.name}
            </span>
            ? It will be removed from every issue in this project.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLabel.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteLabel.mutate(pendingDelete.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast.success('Label deleted.');
            },
            onError: (err) => {
              setPendingDelete(null);
              toast.error(errorMessage(err, 'Could not delete the label.'));
            },
          });
        }}
      />
    </SettingsSection>
  );
}
