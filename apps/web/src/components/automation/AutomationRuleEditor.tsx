/**
 * AutomationRuleEditor — modal for creating or editing an automation rule.
 *
 * Fields: name, description, enabled, trigger, optional NLQL condition,
 * ordered list of actions (each with type + params controls).
 */
import { useId, useState, useEffect } from 'react';
import {
  AutomationActionType,
  AutomationTrigger,
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_LABELS,
  AUTOMATION_TRIGGERS,
  Priority,
} from '@next-lane/shared';
import type {
  AutomationRuleDto,
  AutomationActionDto,
  StatusDto,
  LabelDto,
  MembershipDto,
  CustomFieldDefinitionDto,
} from '@next-lane/shared';
import {
  useCreateAutomation,
  useUpdateAutomation,
  type CreateAutomationInput,
} from '@/api/automations';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { NlqlConditionInput } from './NlqlConditionInput';
import { ActionParamsEditor, type ActionParams } from './ActionParamsEditor';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionRow {
  /** Client-only stable key for list rendering. */
  _key: string;
  type: AutomationActionType;
  params: ActionParams;
}

function defaultParams(type: AutomationActionType): ActionParams {
  switch (type) {
    case AutomationActionType.ASSIGN:
      return { assigneeId: null };
    case AutomationActionType.SET_PRIORITY:
      return { priority: Priority.MEDIUM };
    case AutomationActionType.TRANSITION:
      return { statusId: '' };
    case AutomationActionType.ADD_LABEL:
      return { labelId: '' };
    case AutomationActionType.ADD_COMMENT:
      return { body: '' };
    case AutomationActionType.SET_CUSTOM_FIELD:
      return { fieldId: '', value: null };
  }
}

function newActionRow(type: AutomationActionType = AutomationActionType.ASSIGN): ActionRow {
  return { _key: crypto.randomUUID(), type, params: defaultParams(type) };
}

function toActionDto(row: ActionRow): AutomationActionDto {
  return { type: row.type, params: row.params };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AutomationRuleEditorProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** When provided, we're editing; when undefined, we're creating. */
  rule?: AutomationRuleDto;
  /** Supporting data — passed in by the parent to avoid N+1 hooks. */
  statuses: StatusDto[];
  labels: LabelDto[];
  members: MembershipDto[];
  customFields: CustomFieldDefinitionDto[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AutomationRuleEditor({
  open,
  onClose,
  projectId,
  rule,
  statuses,
  labels,
  members,
  customFields,
}: AutomationRuleEditorProps) {
  const isEditing = !!rule;
  const toast = useToast();
  const create = useCreateAutomation(projectId);
  const update = useUpdateAutomation(projectId);
  const isPending = create.isPending || update.isPending;

  // ------------------------------- form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    AutomationTrigger.ISSUE_CREATED,
  );
  const [condition, setCondition] = useState('');
  const [conditionError, setConditionError] = useState<string | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([newActionRow()]);
  const [formError, setFormError] = useState<string | null>(null);

  // Seed from rule when editing (or reset on open for create).
  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setDescription(rule.description ?? '');
      setEnabled(rule.enabled);
      setTrigger(rule.trigger);
      setCondition(rule.condition ?? '');
      setConditionError(null);
      setActions(
        rule.actions.length > 0
          ? rule.actions.map((a) => ({
              _key: crypto.randomUUID(),
              type: a.type,
              params: a.params as ActionParams,
            }))
          : [newActionRow()],
      );
    } else {
      setName('');
      setDescription('');
      setEnabled(true);
      setTrigger(AutomationTrigger.ISSUE_CREATED);
      setCondition('');
      setConditionError(null);
      setActions([newActionRow()]);
    }
    setFormError(null);
  }, [open, rule]);

  // ------------------------------- action list helpers
  function addAction() {
    setActions((prev) => [...prev, newActionRow()]);
  }

  function removeAction(key: string) {
    setActions((prev) => prev.filter((a) => a._key !== key));
  }

  function moveAction(key: string, dir: 'up' | 'down') {
    setActions((prev) => {
      const idx = prev.findIndex((a) => a._key === key);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = dir === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function updateActionType(key: string, type: AutomationActionType) {
    setActions((prev) =>
      prev.map((a) =>
        a._key === key ? { ...a, type, params: defaultParams(type) } : a,
      ),
    );
  }

  function updateActionParams(key: string, params: ActionParams) {
    setActions((prev) =>
      prev.map((a) => (a._key === key ? { ...a, params } : a)),
    );
  }

  // ------------------------------- submit
  function validate(): boolean {
    if (!name.trim()) {
      setFormError('Rule name is required.');
      return false;
    }
    if (conditionError) {
      setFormError('Fix the NLQL condition error before saving.');
      return false;
    }
    if (actions.length === 0) {
      setFormError('Add at least one action.');
      return false;
    }
    // Check params completeness
    for (const action of actions) {
      if (
        action.type === AutomationActionType.TRANSITION &&
        !action.params.statusId
      ) {
        setFormError('Select a target status for the "Move to status" action.');
        return false;
      }
      if (
        action.type === AutomationActionType.ADD_LABEL &&
        !action.params.labelId
      ) {
        setFormError('Select a label for the "Add label" action.');
        return false;
      }
      if (
        action.type === AutomationActionType.ADD_COMMENT &&
        !(action.params.body as string)?.trim()
      ) {
        setFormError('Enter comment body for the "Add comment" action.');
        return false;
      }
      if (
        action.type === AutomationActionType.SET_CUSTOM_FIELD &&
        !action.params.fieldId
      ) {
        setFormError('Select a field for the "Set custom field" action.');
        return false;
      }
    }
    setFormError(null);
    return true;
  }

  function handleSubmit() {
    if (!validate()) return;

    const payload: CreateAutomationInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      trigger,
      condition: condition.trim() || null,
      actions: actions.map(toActionDto),
    };

    if (isEditing) {
      update.mutate(
        { ruleId: rule!.id, input: payload },
        {
          onSuccess: () => {
            toast.success('Automation rule updated.');
            onClose();
          },
          onError: (err) =>
            setFormError(errorMessage(err, 'Could not save the rule.')),
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toast.success('Automation rule created.');
          onClose();
        },
        onError: (err) =>
          setFormError(errorMessage(err, 'Could not create the rule.')),
      });
    }
  }

  const nameId = useId();
  const descId = useId();

  const cfDefs = customFields.map((d) => ({
    id: d.id,
    key: d.key,
    name: d.name,
    type: d.type,
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Edit automation rule' : 'New automation rule'}
      size="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            data-testid="automation-save"
            onClick={handleSubmit}
            loading={isPending}
          >
            {isEditing ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ── Name + Description ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rule name" htmlFor={nameId}>
            <Input
              id={nameId}
              data-testid="automation-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Auto-assign high-priority bugs"
              disabled={isPending}
              maxLength={120}
              required
            />
          </Field>
          <Field label="Description" htmlFor={descId}>
            <Input
              id={descId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — shown in the rule list"
              disabled={isPending}
              maxLength={300}
            />
          </Field>
        </div>

        {/* ── Trigger ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="When (trigger)" htmlFor="automation-trigger">
            <Select
              id="automation-trigger"
              data-testid="automation-trigger-select"
              value={trigger}
              disabled={isPending}
              onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}
            >
              {AUTOMATION_TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {AUTOMATION_TRIGGER_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>

          {/* Enabled toggle */}
          <div className="flex items-end gap-3 pb-0.5">
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={isPending}
                className="sr-only"
                aria-label="Enable rule"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
                  enabled ? 'bg-signal-600' : 'bg-ink-200',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
                    enabled ? 'translate-x-4' : 'translate-x-0',
                  )}
                />
              </span>
              <span className="text-sm font-medium text-ink-700">
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </div>
        </div>

        {/* ── Condition ── */}
        <NlqlConditionInput
          value={condition}
          onChange={(val, err) => {
            setCondition(val);
            setConditionError(err);
          }}
          customFieldDefs={cfDefs}
          error={conditionError}
          disabled={isPending}
        />

        {/* ── Actions list ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-ink-700">
              Actions{' '}
              <span className="font-normal text-ink-400">
                (run in order when condition matches)
              </span>
            </p>
            <button
              type="button"
              data-testid="automation-action-add"
              onClick={addAction}
              disabled={isPending}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border border-dashed border-signal-300 px-2.5 py-1',
                'text-xs font-semibold text-signal-600 transition-colors',
                'hover:border-signal-400 hover:bg-signal-50',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
              Add action
            </button>
          </div>

          {actions.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-200 py-6 text-center">
              <p className="text-xs text-ink-400">
                No actions yet — add at least one action.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {actions.map((action, idx) => (
              <ActionRowEditor
                key={action._key}
                actionKey={action._key}
                action={action}
                index={idx}
                total={actions.length}
                statuses={statuses}
                labels={labels}
                members={members}
                customFields={customFields}
                disabled={isPending}
                onTypeChange={(type) => updateActionType(action._key, type)}
                onParamsChange={(params) =>
                  updateActionParams(action._key, params)
                }
                onMoveUp={() => moveAction(action._key, 'up')}
                onMoveDown={() => moveAction(action._key, 'down')}
                onRemove={() => removeAction(action._key)}
              />
            ))}
          </div>
        </div>

        {/* ── Form-level error ── */}
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Single action row editor
// ---------------------------------------------------------------------------

interface ActionRowEditorProps {
  actionKey: string;
  action: ActionRow;
  index: number;
  total: number;
  statuses: StatusDto[];
  labels: LabelDto[];
  members: MembershipDto[];
  customFields: CustomFieldDefinitionDto[];
  disabled: boolean;
  onTypeChange: (type: AutomationActionType) => void;
  onParamsChange: (params: ActionParams) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function ActionRowEditor({
  actionKey,
  action,
  index,
  total,
  statuses,
  labels,
  members,
  customFields,
  disabled,
  onTypeChange,
  onParamsChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: ActionRowEditorProps) {
  const typeId = useId();

  return (
    <div
      data-testid="automation-action-row"
      data-action-key={actionKey}
      className="rounded-lg border border-ink-200 bg-ink-50/40 p-3"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-signal-100 text-[10px] font-bold text-signal-700">
          {index + 1}
        </span>

        <div className="flex-1">
          <label htmlFor={typeId} className="sr-only">
            Action type
          </label>
          <Select
            id={typeId}
            data-testid="automation-action-type"
            value={action.type}
            disabled={disabled}
            onChange={(e) =>
              onTypeChange(e.target.value as AutomationActionType)
            }
            className="h-8 text-xs"
          >
            {AUTOMATION_ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {AUTOMATION_ACTION_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>

        {/* Reorder + remove */}
        <div className="flex shrink-0 items-center gap-0.5">
          <MiniIconBtn
            aria-label={`Move action ${index + 1} up`}
            disabled={disabled || index === 0}
            onClick={onMoveUp}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
            </svg>
          </MiniIconBtn>
          <MiniIconBtn
            aria-label={`Move action ${index + 1} down`}
            disabled={disabled || index === total - 1}
            onClick={onMoveDown}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </MiniIconBtn>
          <MiniIconBtn
            aria-label={`Remove action ${index + 1}`}
            disabled={disabled}
            onClick={onRemove}
            danger
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
            </svg>
          </MiniIconBtn>
        </div>
      </div>

      {/* Params for this action type */}
      <div className="pl-7">
        <ActionParamsEditorSwitch
          action={action}
          statuses={statuses}
          labels={labels}
          members={members}
          customFields={customFields}
          disabled={disabled}
          actionIndex={index}
          onParamsChange={onParamsChange}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typed dispatch to ActionParamsEditor
// ---------------------------------------------------------------------------

function ActionParamsEditorSwitch({
  action,
  statuses,
  labels,
  members,
  customFields,
  disabled,
  actionIndex,
  onParamsChange,
}: {
  action: ActionRow;
  statuses: StatusDto[];
  labels: LabelDto[];
  members: MembershipDto[];
  customFields: CustomFieldDefinitionDto[];
  disabled: boolean;
  actionIndex: number;
  onParamsChange: (params: ActionParams) => void;
}) {
  const base = {
    params: action.params,
    onChange: onParamsChange,
    disabled,
    actionIndex,
  };

  switch (action.type) {
    case AutomationActionType.ASSIGN:
      return <ActionParamsEditor {...base} type={AutomationActionType.ASSIGN} members={members} />;
    case AutomationActionType.SET_PRIORITY:
      return <ActionParamsEditor {...base} type={AutomationActionType.SET_PRIORITY} />;
    case AutomationActionType.TRANSITION:
      return <ActionParamsEditor {...base} type={AutomationActionType.TRANSITION} statuses={statuses} />;
    case AutomationActionType.ADD_LABEL:
      return <ActionParamsEditor {...base} type={AutomationActionType.ADD_LABEL} labels={labels} />;
    case AutomationActionType.ADD_COMMENT:
      return <ActionParamsEditor {...base} type={AutomationActionType.ADD_COMMENT} />;
    case AutomationActionType.SET_CUSTOM_FIELD:
      return <ActionParamsEditor {...base} type={AutomationActionType.SET_CUSTOM_FIELD} customFields={customFields} />;
  }
}

// ---------------------------------------------------------------------------
// Mini icon button
// ---------------------------------------------------------------------------

function MiniIconBtn({
  children,
  onClick,
  disabled,
  danger,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300',
        disabled
          ? 'cursor-not-allowed text-ink-200'
          : danger
            ? 'text-ink-400 hover:bg-red-50 hover:text-red-600'
            : 'text-ink-400 hover:bg-ink-100 hover:text-ink-700',
      )}
    >
      {children}
    </button>
  );
}
