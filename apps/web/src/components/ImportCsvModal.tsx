import { useEffect, useId, useRef, useState } from 'react';
import { type ImportIssuesResultDto } from '@next-lane/shared';
import { useImportIssues } from '@/api/import';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';

/** Accepted columns, shown as a hint inside the modal. */
const ACCEPTED_COLUMNS = [
  'Title (required)',
  'Description',
  'Type',
  'Priority',
  'Status',
  'Assignee (email)',
  'Labels (comma/semicolon)',
  'Story Points',
  'Due Date',
];

export interface ImportCsvModalProps {
  projectId: string;
  onClose: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'dryRunning' }
  | { kind: 'preview'; result: ImportIssuesResultDto }
  | { kind: 'importing' }
  | { kind: 'done'; result: ImportIssuesResultDto };

export function ImportCsvModal({ projectId, onClose }: ImportCsvModalProps) {
  const { dryRun, importCsv } = useImportIssues(projectId);
  const toast = useToast();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hintsOpen, setHintsOpen] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // Run the dry-run automatically whenever the user picks a new file.
  useEffect(() => {
    if (!file) return;
    setPhase({ kind: 'dryRunning' });
    dryRun(file)
      .then((result) => setPhase({ kind: 'preview', result }))
      .catch((err: unknown) => {
        setPhase({ kind: 'idle' });
        toast.error(errorMessage(err, 'Validation failed. Please check your CSV.'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    setFile(chosen);
    // Reset so the user can pick the same filename again after clearing.
    e.target.value = '';
  }

  function handleImport() {
    if (!file || phase.kind !== 'preview') return;
    // Capture the last preview result so we can restore it if the real import
    // fails (the phase will have moved to 'importing' and lost the result).
    const lastPreview = phase.result;
    setPhase({ kind: 'importing' });
    importCsv(file)
      .then((result) => {
        setPhase({ kind: 'done', result });
        toast.success(
          `Imported ${result.created} ${result.created === 1 ? 'issue' : 'issues'}.`,
        );
        onClose();
      })
      .catch((err: unknown) => {
        setPhase({ kind: 'preview', result: lastPreview });
        toast.error(errorMessage(err, 'Import failed. Please try again.'));
      });
  }

  const isLoading =
    phase.kind === 'dryRunning' || phase.kind === 'importing';

  const previewResult =
    phase.kind === 'preview' ? phase.result : null;

  // The Import button is enabled when the preview shows at least one row to
  // create and we are not currently in-flight.
  const canImport =
    phase.kind === 'preview' && phase.result.created > 0 && !isLoading;

  return (
    <Modal
      open
      onClose={onClose}
      title="Import CSV"
      size="max-w-lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            data-testid="import-csv-submit"
            type="button"
            loading={phase.kind === 'importing'}
            disabled={!canImport}
            onClick={handleImport}
          >
            Import
          </Button>
        </>
      }
    >
      <div data-testid="import-csv-modal" className="space-y-4">
        {/* File picker */}
        <div className="space-y-1.5">
          <label
            htmlFor={fileInputId}
            className="block text-sm font-medium text-ink-700"
          >
            CSV file
          </label>
          <input
            ref={fileInputRef}
            id={fileInputId}
            data-testid="import-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={isLoading}
            aria-label="CSV file to import"
            className={[
              'block w-full cursor-pointer rounded-lg border border-ink-200 bg-white',
              'px-3 py-2 text-sm text-ink-700 file:mr-3 file:cursor-pointer',
              'file:rounded file:border-0 file:bg-ink-100 file:px-2.5 file:py-1',
              'file:text-xs file:font-medium file:text-ink-700',
              'transition-colors duration-[120ms]',
              'hover:border-ink-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          />
        </div>

        {/* Column hints (collapsible) */}
        <div className="rounded-lg border border-ink-100 bg-ink-50">
          <button
            type="button"
            onClick={() => setHintsOpen((v) => !v)}
            aria-expanded={hintsOpen}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-medium text-ink-600 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            <span>Accepted columns</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className={`shrink-0 transition-transform duration-150 ${hintsOpen ? 'rotate-180' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {hintsOpen && (
            <div className="border-t border-ink-100 px-3 py-2.5">
              <p className="mb-1.5 text-xs text-ink-500">
                Column headers are case-insensitive. <strong>Title</strong> is the only required column.
              </p>
              <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-ink-600">
                {ACCEPTED_COLUMNS.map((col) => (
                  <li key={col} className="flex items-center gap-1">
                    <span aria-hidden="true" className="text-ink-300">—</span>
                    {col}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Dry-run loading state */}
        {phase.kind === 'dryRunning' && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg bg-signal-50 px-3 py-2.5 text-sm text-signal-700"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className="shrink-0 animate-spin"
            >
              <path strokeLinecap="round" d="M12 2a10 10 0 0 1 0 20A10 10 0 0 1 12 2" opacity=".25" />
              <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            Validating…
          </div>
        )}

        {/* Preview / dry-run summary */}
        {previewResult && (
          <div
            data-testid="import-csv-dryrun-summary"
            role="region"
            aria-live="polite"
            aria-label="Import preview"
            className="space-y-2 rounded-lg border border-ink-200 p-3"
          >
            <p className="text-sm text-ink-700">
              <span className="font-semibold text-ink-900">
                {previewResult.created}
              </span>{' '}
              {previewResult.created === 1 ? 'issue' : 'issues'} will be created
              {previewResult.skipped > 0 && (
                <>,{' '}
                  <span className="font-semibold">{previewResult.skipped}</span>{' '}
                  {previewResult.skipped === 1 ? 'row' : 'rows'} skipped
                </>
              )}
              .
            </p>

            {previewResult.created === 0 && previewResult.errors.length === 0 && (
              <p className="text-xs text-ink-500">
                No importable rows found. The file may be empty or missing a Title column.
              </p>
            )}

            {previewResult.errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-red-700">
                  {previewResult.errors.length}{' '}
                  {previewResult.errors.length === 1 ? 'row has an error' : 'rows have errors'} and will be skipped:
                </p>
                <ul
                  className="max-h-40 overflow-y-auto rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 space-y-0.5"
                  aria-label="Row errors"
                >
                  {previewResult.errors.map((e) => (
                    <li
                      key={`row-${e.row}`}
                      data-testid="import-csv-error-row"
                      className="leading-snug"
                    >
                      <span className="font-medium">Row {e.row}:</span> {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Choose a different file */}
        {(phase.kind === 'preview') && (
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setPhase({ kind: 'idle' });
              fileInputRef.current?.click();
            }}
            className="text-xs text-signal-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
          >
            Choose a different file
          </button>
        )}
      </div>
    </Modal>
  );
}
