/**
 * CardColorsManager — ordered list editor for a board's colorRules.
 *
 * Renders inside the BoardSettingsModal (as its own tab/section). Each row
 * lets the user edit a NLQL query (with live validateQuery), pick a color
 * from an accessible preset palette (+ free hex input), and provide an optional
 * label. Rules are numbered (first-match-wins order is visible). Supports
 * add / edit / delete / reorder (up / down).
 *
 * On Save the whole array is persisted via useUpdateBoard.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  validateQuery,
  type BoardColorRule,
  type CustomFieldDefinitionDto,
} from '@next-lane/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PRESET_COLORS, invalidateAstCache } from '@/lib/cardColors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuleRow {
  id: string;
  query: string;
  color: string;
  label: string;
  // local validation state (recomputed on each keystroke)
  queryError: string | null;
}

// ---------------------------------------------------------------------------
// Color picker
// ---------------------------------------------------------------------------

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  'data-testid'?: string;
}

function ColorPicker({ value, onChange, 'data-testid': testId }: ColorPickerProps) {
  const hexInputId = useId();

  /** Validate a #rrggbb hex string (also accepts shorthand #rgb). */
  function isValidHex(hex: string): boolean {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
  }

  const [hex, setHex] = useState(value);

  // Keep local hex in sync when parent value changes (e.g. preset click).
  useEffect(() => {
    setHex(value);
  }, [value]);

  function handleHexChange(raw: string) {
    const v = raw.startsWith('#') ? raw : `#${raw}`;
    setHex(v);
    if (isValidHex(v)) onChange(v);
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      {/* Preset swatches */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset colors">
        {PRESET_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            aria-label={c.label}
            title={c.label}
            onClick={() => onChange(c.hex)}
            style={{ backgroundColor: c.hex }}
            className={cn(
              'h-6 w-6 rounded-full border-2 transition-all duration-100',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-brand-300',
              'hover:scale-110 active:scale-95',
              value.toLowerCase() === c.hex.toLowerCase()
                ? 'border-slate-800 ring-2 ring-slate-400 ring-offset-1'
                : 'border-white shadow-xs',
            )}
          />
        ))}
      </div>

      {/* Free hex input */}
      <div className="flex items-center gap-2">
        <div
          className="h-6 w-6 shrink-0 rounded border border-slate-300"
          style={{ backgroundColor: isValidHex(hex) ? hex : undefined }}
          aria-hidden="true"
        />
        <Input
          id={hexInputId}
          aria-label="Custom hex color"
          value={hex}
          onChange={(e) => handleHexChange(e.target.value)}
          placeholder="#3b82f6"
          className="h-8 w-28 font-mono text-xs"
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single rule row
// ---------------------------------------------------------------------------

interface RuleRowEditorProps {
  rule: RuleRow;
  index: number;
  total: number;
  customFieldDefs: { id: string; key: string; name: string; type: import('@next-lane/shared').CustomFieldType }[];
  onChange: (updated: RuleRow) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function RuleRowEditor({
  rule,
  index,
  total,
  customFieldDefs,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: RuleRowEditorProps) {
  const queryId = useId();
  const labelId = useId();

  function updateQuery(q: string) {
    const result = q.trim() ? validateQuery(q.trim(), { customFieldDefs }) : null;
    onChange({
      ...rule,
      query: q,
      queryError: result && !result.ok ? (result.error?.message ?? 'Invalid query') : null,
    });
  }

  const isFirstPreset = PRESET_COLORS.some(
    (c) => c.hex.toLowerCase() === rule.color.toLowerCase(),
  );
  const presetLabel = isFirstPreset
    ? PRESET_COLORS.find((c) => c.hex.toLowerCase() === rule.color.toLowerCase())?.label
    : null;

  return (
    <div
      data-testid="color-rule-row"
      data-rule-id={rule.id}
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs"
    >
      {/* Header row: rule number + reorder + delete */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500"
          aria-label={`Rule ${index + 1} (first match wins)`}
        >
          {index + 1}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="color-rule-up"
            aria-label="Move rule up"
            disabled={index === 0}
            onClick={onMoveUp}
            className={cn(
              'rounded p-1 text-slate-400 transition-colors',
              'hover:bg-slate-100 hover:text-slate-600',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
              'disabled:cursor-not-allowed disabled:opacity-30',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
            </svg>
          </button>
          <button
            type="button"
            data-testid="color-rule-down"
            aria-label="Move rule down"
            disabled={index === total - 1}
            onClick={onMoveDown}
            className={cn(
              'rounded p-1 text-slate-400 transition-colors',
              'hover:bg-slate-100 hover:text-slate-600',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
              'disabled:cursor-not-allowed disabled:opacity-30',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            data-testid="color-rule-delete"
            aria-label={`Delete rule ${index + 1}`}
            onClick={onDelete}
            className={cn(
              'rounded p-1 text-slate-400 transition-colors',
              'hover:bg-red-50 hover:text-red-600',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* NLQL query */}
      <div className="mb-2 space-y-1">
        <label htmlFor={queryId} className="block text-xs font-semibold text-slate-500">
          Condition (NLQL)
        </label>
        <Input
          id={queryId}
          data-testid="color-rule-query"
          value={rule.query}
          onChange={(e) => updateQuery(e.target.value)}
          placeholder="priority = HIGH"
          className={cn(
            'font-mono text-xs',
            rule.queryError && 'border-red-400 focus:border-red-500 focus:ring-red-200',
          )}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!rule.queryError}
          aria-describedby={rule.queryError ? `${queryId}-err` : undefined}
        />
        {rule.queryError && (
          <p id={`${queryId}-err`} role="alert" className="text-xs text-red-600">
            {rule.queryError}
          </p>
        )}
      </div>

      {/* Color picker */}
      <div className="mb-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Color</span>
          <span
            className="inline-flex h-4 w-4 rounded-full border border-slate-300"
            style={{ backgroundColor: rule.color }}
            aria-hidden="true"
          />
          {presetLabel && (
            <span className="text-[11px] text-slate-400">{presetLabel}</span>
          )}
        </div>
        <ColorPicker
          value={rule.color}
          onChange={(hex) => onChange({ ...rule, color: hex })}
          data-testid="color-rule-color"
        />
      </div>

      {/* Optional label */}
      <div className="space-y-1">
        <label htmlFor={labelId} className="block text-xs font-semibold text-slate-500">
          Label <span className="font-normal text-slate-400">(optional — shown in legend)</span>
        </label>
        <Input
          id={labelId}
          value={rule.label}
          onChange={(e) => onChange({ ...rule, label: e.target.value })}
          placeholder="e.g. High priority"
          className="text-xs"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main manager
// ---------------------------------------------------------------------------

export interface CardColorsManagerProps {
  boardId: string;
  projectId: string;
  initialRules: BoardColorRule[];
  customFieldDefs: CustomFieldDefinitionDto[];
  onSave: (rules: BoardColorRule[]) => Promise<void>;
  isSaving: boolean;
}

export function CardColorsManager({
  initialRules,
  customFieldDefs,
  onSave,
  isSaving,
}: CardColorsManagerProps) {
  const [rows, setRows] = useState<RuleRow[]>(() =>
    initialRules.map((r) => ({
      id: r.id,
      query: r.query,
      color: r.color,
      label: r.label ?? '',
      queryError: null,
    })),
  );
  const [dirty, setDirty] = useState(false);

  // Keep rows in sync when initialRules change (e.g. after save).
  const prevRulesRef = useRef(initialRules);
  useEffect(() => {
    if (prevRulesRef.current === initialRules) return;
    prevRulesRef.current = initialRules;
    if (!dirty) {
      setRows(
        initialRules.map((r) => ({
          id: r.id,
          query: r.query,
          color: r.color,
          label: r.label ?? '',
          queryError: null,
        })),
      );
    }
  }, [initialRules, dirty]);

  const cfDefs = useMemo(
    () =>
      customFieldDefs.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        type: d.type,
      })),
    [customFieldDefs],
  );

  function addRule() {
    const id = crypto.randomUUID();
    setRows((prev) => [
      ...prev,
      { id, query: '', color: PRESET_COLORS[0].hex, label: '', queryError: null },
    ]);
    setDirty(true);
  }

  function updateRow(index: number, updated: RuleRow) {
    setRows((prev) => prev.map((r, i) => (i === index ? updated : r)));
    setDirty(true);
  }

  function deleteRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    setRows((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
    setDirty(true);
  }

  function moveDown(index: number) {
    setRows((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    setDirty(true);
  }

  const hasErrors = rows.some((r) => r.queryError !== null);

  const handleSave = useCallback(async () => {
    if (hasErrors) return;
    const rules: BoardColorRule[] = rows.map((r) => ({
      id: r.id,
      query: r.query.trim(),
      color: r.color,
      label: r.label.trim() || undefined,
    }));
    // Invalidate AST cache for changed rules.
    for (const r of rules) invalidateAstCache(r.id);
    await onSave(rules);
    setDirty(false);
  }, [hasErrors, rows, onSave]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <p className="text-xs text-slate-500">
          Rules are evaluated top-to-bottom — the first match wins. Drag or use
          the arrows to reorder.
        </p>
      </div>

      {/* Rule list */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-6 text-center">
          <p className="text-xs text-slate-400">No color rules yet. Add one below.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <RuleRowEditor
              key={row.id}
              rule={row}
              index={i}
              total={rows.length}
              customFieldDefs={cfDefs}
              onChange={(updated) => updateRow(i, updated)}
              onDelete={() => deleteRow(i)}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
            />
          ))}
        </div>
      )}

      {/* Add + Save */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          data-testid="color-rule-add"
          onClick={addRule}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 px-3 py-1.5',
            'text-xs font-semibold text-brand-600 transition-colors',
            'hover:border-brand-400 hover:bg-brand-50',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
          )}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
          Add rule
        </button>

        <Button
          size="sm"
          onClick={() => void handleSave()}
          loading={isSaving}
          disabled={!dirty || hasErrors || isSaving}
        >
          Save colors
        </Button>
      </div>

      {hasErrors && (
        <p role="alert" className="text-xs text-red-600">
          Fix query errors before saving.
        </p>
      )}
    </div>
  );
}
