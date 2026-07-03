/**
 * Create/edit modal for a dashboard gadget: an NLQL query (reusing the same
 * `NlqlInput` autocomplete the board filter uses) + a visualization picker +
 * visualization-specific config fields.
 */
import { useEffect, useMemo, useState } from 'react';
import { validateQuery, DashboardGadgetVisualization, type DashboardGadgetDto } from '@next-lane/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { NlqlInput } from '@/components/board/NlqlInput';
import { useCustomFields } from '@/api/custom-fields';
import { useStatuses } from '@/api/meta';
import { useCreateGadget, useUpdateGadget, type GadgetInput } from '@/api/dashboards';
import { useToast } from '@/components/ui/Toast';
import { CustomFieldType } from '@next-lane/shared';

const VISUALIZATION_OPTIONS: { value: DashboardGadgetVisualization; label: string; hint: string }[] = [
  { value: DashboardGadgetVisualization.STAT, label: 'Stat', hint: 'A single count of matching issues.' },
  { value: DashboardGadgetVisualization.TABLE, label: 'Table', hint: 'A compact list of matching issues.' },
  { value: DashboardGadgetVisualization.BREAKDOWN, label: 'Breakdown', hint: 'Counts grouped by a field.' },
  { value: DashboardGadgetVisualization.BURNDOWN, label: 'Burndown', hint: "Sprint burndown for the query's sprint." },
  {
    value: DashboardGadgetVisualization.VELOCITY_TREND,
    label: 'Velocity trend',
    hint: 'Committed vs completed points over the project’s last N sprints.',
  },
];

const STANDARD_BREAKDOWN_FIELDS = [
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'type', label: 'Type' },
  { value: 'label', label: 'Label' },
  { value: 'component', label: 'Component' },
];

const TABLE_COLUMN_OPTIONS = [
  { value: 'key', label: 'Key' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'points', label: 'Points' },
];

export interface GadgetFormModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  dashboardId: string;
  /** Present when editing an existing gadget; absent for create. */
  gadget?: DashboardGadgetDto;
}

export function GadgetFormModal({ open, onClose, projectId, dashboardId, gadget }: GadgetFormModalProps) {
  const isEdit = !!gadget;
  const toast = useToast();
  const customFieldsQuery = useCustomFields(projectId);
  const statusesQuery = useStatuses(projectId);
  const createGadget = useCreateGadget(dashboardId, projectId);
  const updateGadget = useUpdateGadget(dashboardId);

  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [visualization, setVisualization] = useState<DashboardGadgetVisualization>(
    DashboardGadgetVisualization.STAT,
  );
  const [field, setField] = useState('');
  const [columns, setColumns] = useState<string[]>(TABLE_COLUMN_OPTIONS.map((c) => c.value));
  const [limit, setLimit] = useState(10);
  const [sprintsCount, setSprintsCount] = useState(6);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (gadget) {
      setTitle(gadget.title);
      setQuery(gadget.query);
      setVisualization(gadget.visualization);
      setField(gadget.config.field ?? '');
      setColumns(gadget.config.columns ?? TABLE_COLUMN_OPTIONS.map((c) => c.value));
      setLimit(gadget.config.limit ?? 10);
      setSprintsCount(gadget.config.sprints ?? 6);
      setWide((gadget.config.size ?? 1) >= 2);
    } else {
      setTitle('');
      setQuery('');
      setVisualization(DashboardGadgetVisualization.STAT);
      setField('');
      setColumns(TABLE_COLUMN_OPTIONS.map((c) => c.value));
      setLimit(10);
      setSprintsCount(6);
      setWide(false);
    }
  }, [open, gadget]);

  const customFieldDefs = useMemo(
    () =>
      (customFieldsQuery.data ?? []).map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        type: d.type,
      })),
    [customFieldsQuery.data],
  );

  const breakdownFieldOptions = useMemo(() => {
    const customOpts = (customFieldsQuery.data ?? [])
      .filter((d) => d.type === CustomFieldType.SELECT || d.type === CustomFieldType.MULTI_SELECT)
      .map((d) => ({ value: d.key, label: `${d.name} (custom)` }));
    return [...STANDARD_BREAKDOWN_FIELDS, ...customOpts];
  }, [customFieldsQuery.data]);

  const statusNames = useMemo(
    () => (statusesQuery.data ?? []).map((s) => s.name),
    [statusesQuery.data],
  );

  const queryError = useMemo(() => {
    const result = validateQuery(query, { customFieldDefs });
    return result.ok ? null : result.error?.message ?? 'Invalid query';
  }, [query, customFieldDefs]);

  const needsField = visualization === DashboardGadgetVisualization.BREAKDOWN;
  const fieldMissing = needsField && !field;

  const canSave = title.trim().length > 0 && !queryError && !fieldMissing;
  const isSaving = createGadget.isPending || updateGadget.isPending;

  async function handleSave() {
    if (!canSave) return;
    const input: GadgetInput = {
      title: title.trim(),
      query,
      visualization,
      config: {
        ...(visualization === DashboardGadgetVisualization.BREAKDOWN ? { field } : {}),
        ...(visualization === DashboardGadgetVisualization.TABLE
          ? { columns, limit }
          : {}),
        ...(visualization === DashboardGadgetVisualization.VELOCITY_TREND
          ? { sprints: sprintsCount }
          : {}),
        size: wide ? 2 : 1,
      },
    };
    try {
      if (isEdit) {
        await updateGadget.mutateAsync({ gadgetId: gadget.id, patch: input });
        toast.success('Gadget updated');
      } else {
        await createGadget.mutateAsync(input);
        toast.success('Gadget added');
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save gadget');
    }
  }

  function toggleColumn(col: string) {
    setColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit gadget' : 'Add gadget'}
      size="max-w-lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="gadget-save"
            onClick={() => void handleSave()}
            loading={isSaving}
            disabled={!canSave || isSaving}
          >
            {isEdit ? 'Save changes' : 'Add gadget'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="gadget-title">
          <Input
            id="gadget-title"
            data-testid="gadget-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Open bugs"
            maxLength={120}
          />
        </Field>

        <Field label="Query (NLQL)" htmlFor="gadget-query">
          <NlqlInput
            value={query}
            onChange={setQuery}
            projectId={projectId}
            customFieldDefs={customFieldDefs}
            statuses={statusNames}
            data-testid="gadget-query-input"
            aria-label="Gadget NLQL query"
            aria-invalid={!!queryError}
            placeholder="Leave empty to match every issue, or e.g. priority = HIGH"
          />
          {queryError && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {queryError}
            </p>
          )}
        </Field>

        <Field label="Visualization" htmlFor="gadget-visualization">
          <Select
            id="gadget-visualization"
            data-testid="gadget-visualization-select"
            value={visualization}
            onChange={(e) => setVisualization(e.target.value as DashboardGadgetVisualization)}
          >
            {VISUALIZATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-ink-400">
            {VISUALIZATION_OPTIONS.find((o) => o.value === visualization)?.hint}
          </p>
        </Field>

        {visualization === DashboardGadgetVisualization.BREAKDOWN && (
          <Field label="Group by" htmlFor="gadget-breakdown-field">
            <Select
              id="gadget-breakdown-field"
              data-testid="gadget-breakdown-field-select"
              value={field}
              onChange={(e) => setField(e.target.value)}
            >
              <option value="">Select a field…</option>
              {breakdownFieldOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {visualization === DashboardGadgetVisualization.TABLE && (
          <>
            <Field label="Columns">
              <div className="flex flex-wrap gap-3" role="group" aria-label="Table columns">
                {TABLE_COLUMN_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 text-xs text-ink-700">
                    <input
                      type="checkbox"
                      checked={columns.includes(opt.value)}
                      onChange={() => toggleColumn(opt.value)}
                      className="h-3.5 w-3.5 rounded border-ink-300 text-signal-600 focus-visible:ring-2 focus-visible:ring-signal-200"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Max rows" htmlFor="gadget-limit">
              <Input
                id="gadget-limit"
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) => setLimit(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                className="w-24"
              />
            </Field>
          </>
        )}

        {visualization === DashboardGadgetVisualization.BURNDOWN && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
            This gadget's query must match issues from exactly one sprint —
            e.g. <code className="font-mono">sprint = &quot;Sprint 3&quot;</code>.
          </p>
        )}

        {visualization === DashboardGadgetVisualization.VELOCITY_TREND && (
          <>
            <Field label="Sprints to include" htmlFor="gadget-sprints">
              <Input
                id="gadget-sprints"
                data-testid="gadget-sprints-input"
                type="number"
                min={1}
                max={24}
                value={sprintsCount}
                onChange={(e) =>
                  setSprintsCount(Math.min(24, Math.max(1, Number(e.target.value) || 6)))
                }
                className="w-24"
              />
            </Field>
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
              Shows committed vs. completed story points across the project's
              most recent sprints, project-wide — the query above isn't used
              for this visualization.
            </p>
          </>
        )}

        <label className="flex items-center gap-1.5 text-xs text-ink-700">
          <input
            type="checkbox"
            checked={wide}
            onChange={(e) => setWide(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-300 text-signal-600 focus-visible:ring-2 focus-visible:ring-signal-200"
          />
          Wide (spans two columns)
        </label>
      </div>
    </Modal>
  );
}
