import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useArchiveProject } from '@/api/projects';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { SettingsSection } from './SettingsSection';

/* ---------------------------------------------------------------- danger zone */

export function ProjectDangerZone({
  projectId,
  projectName,
  archived,
  isAdmin,
}: {
  projectId: string;
  projectName: string;
  archived: boolean;
  isAdmin: boolean;
}) {
  const archive = useArchiveProject(projectId);
  const toast = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  if (archived) {
    return (
      <SettingsSection title="Archived" description="This project has been archived.">
        <p className="text-sm text-slate-500">
          Archived projects are hidden from active work.
        </p>
      </SettingsSection>
    );
  }

  if (!isAdmin) return null;

  return (
    <section className="rounded-xl border border-red-200 bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Archiving hides the project from active work. This can be undone by
            an administrator.
          </p>
        </div>
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
          className="shrink-0"
        >
          Archive project
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Archive project"
        message={
          <>
            Archive{' '}
            <span className="font-medium text-slate-900">{projectName}</span>? It
            will be hidden from the projects list.
          </>
        }
        confirmLabel="Archive project"
        variant="danger"
        loading={archive.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          archive.mutate(undefined, {
            onSuccess: () => {
              toast.success(`Archived "${projectName}".`);
              navigate('/');
            },
            onError: (err) => {
              setConfirming(false);
              toast.error(errorMessage(err, 'Could not archive the project.'));
            },
          });
        }}
      />
    </section>
  );
}
