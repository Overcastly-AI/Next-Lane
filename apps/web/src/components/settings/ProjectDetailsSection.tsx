import { useEffect, useState, type FormEvent } from 'react';
import { useUpdateProject } from '@/api/projects';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Field } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { SettingsSection } from './SettingsSection';

/* ------------------------------------------------------------------ details */

export function ProjectDetailsSection({
  projectId,
  projectKey,
  name,
  description,
  editable,
}: {
  projectId: string;
  projectKey: string;
  name: string;
  description: string | null;
  editable: boolean;
}) {
  const update = useUpdateProject(projectId);
  const toast = useToast();
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description ?? '');

  // Re-seed when the server values change (e.g. realtime / refetch).
  useEffect(() => {
    setDraftName(name);
    setDraftDesc(description ?? '');
  }, [name, description]);

  const dirty =
    draftName.trim() !== name || draftDesc.trim() !== (description ?? '');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) return;
    update.mutate(
      { name: trimmed, description: draftDesc.trim() },
      {
        onSuccess: () => toast.success('Project details saved.'),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not save the project.')),
      },
    );
  }

  return (
    <SettingsSection title="Project details" description="The project key cannot be changed.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Key" htmlFor="settings-key">
          <Input id="settings-key" value={projectKey} readOnly disabled />
        </Field>
        <Field label="Name" htmlFor="settings-name">
          <Input
            id="settings-name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            disabled={!editable}
            maxLength={80}
            required
          />
        </Field>
        <Field label="Description" htmlFor="settings-description">
          <Textarea
            id="settings-description"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            disabled={!editable}
            rows={3}
            maxLength={2000}
            placeholder="What is this project about?"
          />
        </Field>
        {editable && (
          <div className="flex justify-end">
            <Button
              type="submit"
              loading={update.isPending}
              disabled={!dirty || !draftName.trim()}
            >
              Save changes
            </Button>
          </div>
        )}
      </form>
    </SettingsSection>
  );
}
