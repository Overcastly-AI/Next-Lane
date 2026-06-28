/**
 * ActionParamsEditor — renders the right param control based on action type.
 *
 * ASSIGN           → member select (+ "Unassign" option)
 * SET_PRIORITY     → priority select
 * TRANSITION       → status select
 * ADD_LABEL        → label select
 * ADD_COMMENT      → textarea
 * SET_CUSTOM_FIELD → field select + value input by field type
 */
import { useId } from 'react';
import {
  AutomationActionType,
  Priority,
  PRIORITIES,
} from '@next-lane/shared';
import type {
  StatusDto,
  LabelDto,
  MembershipDto,
  CustomFieldDefinitionDto,
  CustomFieldValue,
} from '@next-lane/shared';
import { CustomFieldType } from '@next-lane/shared';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';

const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.HIGHEST]: 'Highest',
  [Priority.HIGH]: 'High',
  [Priority.MEDIUM]: 'Medium',
  [Priority.LOW]: 'Low',
  [Priority.LOWEST]: 'Lowest',
};

export type ActionParams = Record<string, unknown>;

interface BaseProps {
  params: ActionParams;
  onChange: (params: ActionParams) => void;
  disabled?: boolean;
  /** Index for stable id generation. */
  actionIndex: number;
}

interface AssignProps extends BaseProps {
  type: AutomationActionType.ASSIGN;
  members: MembershipDto[];
}

interface SetPriorityProps extends BaseProps {
  type: AutomationActionType.SET_PRIORITY;
}

interface TransitionProps extends BaseProps {
  type: AutomationActionType.TRANSITION;
  statuses: StatusDto[];
}

interface AddLabelProps extends BaseProps {
  type: AutomationActionType.ADD_LABEL;
  labels: LabelDto[];
}

interface AddCommentProps extends BaseProps {
  type: AutomationActionType.ADD_COMMENT;
}

interface SetCustomFieldProps extends BaseProps {
  type: AutomationActionType.SET_CUSTOM_FIELD;
  customFields: CustomFieldDefinitionDto[];
}

export type ActionParamsEditorProps =
  | AssignProps
  | SetPriorityProps
  | TransitionProps
  | AddLabelProps
  | AddCommentProps
  | SetCustomFieldProps;

export function ActionParamsEditor(props: ActionParamsEditorProps) {
  const id = useId();

  switch (props.type) {
    case AutomationActionType.ASSIGN: {
      const assigneeId =
        typeof props.params.assigneeId === 'string'
          ? props.params.assigneeId
          : '__unassign__';
      return (
        <div className="space-y-1">
          <label
            htmlFor={`${id}-assign`}
            className="block text-xs font-medium text-ink-500"
          >
            Assignee
          </label>
          <Select
            id={`${id}-assign`}
            value={assigneeId}
            disabled={props.disabled}
            onChange={(e) => {
              const v = e.target.value;
              props.onChange({
                assigneeId: v === '__unassign__' ? null : v,
              });
            }}
          >
            <option value="__unassign__">— Unassign —</option>
            {props.members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.name}
              </option>
            ))}
          </Select>
        </div>
      );
    }

    case AutomationActionType.SET_PRIORITY: {
      const priority =
        typeof props.params.priority === 'string'
          ? (props.params.priority as Priority)
          : Priority.MEDIUM;
      return (
        <div className="space-y-1">
          <label
            htmlFor={`${id}-priority`}
            className="block text-xs font-medium text-ink-500"
          >
            Priority
          </label>
          <Select
            id={`${id}-priority`}
            value={priority}
            disabled={props.disabled}
            onChange={(e) =>
              props.onChange({ priority: e.target.value as Priority })
            }
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
      );
    }

    case AutomationActionType.TRANSITION: {
      const statusId =
        typeof props.params.statusId === 'string' ? props.params.statusId : '';
      return (
        <div className="space-y-1">
          <label
            htmlFor={`${id}-status`}
            className="block text-xs font-medium text-ink-500"
          >
            Target status
          </label>
          <Select
            id={`${id}-status`}
            value={statusId}
            disabled={props.disabled}
            onChange={(e) => props.onChange({ statusId: e.target.value })}
          >
            <option value="">— Pick a status —</option>
            {props.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      );
    }

    case AutomationActionType.ADD_LABEL: {
      const labelId =
        typeof props.params.labelId === 'string' ? props.params.labelId : '';
      return (
        <div className="space-y-1">
          <label
            htmlFor={`${id}-label`}
            className="block text-xs font-medium text-ink-500"
          >
            Label
          </label>
          <Select
            id={`${id}-label`}
            value={labelId}
            disabled={props.disabled}
            onChange={(e) => props.onChange({ labelId: e.target.value })}
          >
            <option value="">— Pick a label —</option>
            {props.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      );
    }

    case AutomationActionType.ADD_COMMENT: {
      const body =
        typeof props.params.body === 'string' ? props.params.body : '';
      return (
        <div className="space-y-1">
          <label
            htmlFor={`${id}-comment`}
            className="block text-xs font-medium text-ink-500"
          >
            Comment body
          </label>
          <Textarea
            id={`${id}-comment`}
            value={body}
            disabled={props.disabled}
            rows={3}
            maxLength={2000}
            placeholder="This issue was automatically updated…"
            onChange={(e) => props.onChange({ body: e.target.value })}
          />
        </div>
      );
    }

    case AutomationActionType.SET_CUSTOM_FIELD: {
      const fieldId =
        typeof props.params.fieldId === 'string' ? props.params.fieldId : '';
      const fieldValue = props.params.value as CustomFieldValue | undefined;
      const selectedField = props.customFields.find((f) => f.id === fieldId);

      return (
        <div className="space-y-2">
          <div className="space-y-1">
            <label
              htmlFor={`${id}-cf-field`}
              className="block text-xs font-medium text-ink-500"
            >
              Field
            </label>
            <Select
              id={`${id}-cf-field`}
              value={fieldId}
              disabled={props.disabled}
              onChange={(e) =>
                props.onChange({ fieldId: e.target.value, value: null })
              }
            >
              <option value="">— Pick a field —</option>
              {props.customFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>

          {selectedField && (
            <CustomFieldValueInput
              id={`${id}-cf-value`}
              field={selectedField}
              value={fieldValue ?? null}
              disabled={props.disabled}
              onChange={(v) =>
                props.onChange({ fieldId, value: v })
              }
            />
          )}
        </div>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Custom field value input by type (subset — enough for automation params)
// ---------------------------------------------------------------------------

function CustomFieldValueInput({
  id,
  field,
  value,
  onChange,
  disabled,
}: {
  id: string;
  field: CustomFieldDefinitionDto;
  value: CustomFieldValue;
  onChange: (v: CustomFieldValue) => void;
  disabled?: boolean;
}) {
  const labelClass = 'block text-xs font-medium text-ink-500';

  switch (field.type) {
    case CustomFieldType.TEXT:
    case CustomFieldType.URL: {
      return (
        <div className="space-y-1">
          <label htmlFor={id} className={labelClass}>Value</label>
          <Input
            id={id}
            type={field.type === CustomFieldType.URL ? 'url' : 'text'}
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
          />
        </div>
      );
    }
    case CustomFieldType.NUMBER: {
      return (
        <div className="space-y-1">
          <label htmlFor={id} className={labelClass}>Value</label>
          <Input
            id={id}
            type="number"
            value={typeof value === 'number' ? String(value) : ''}
            disabled={disabled}
            onChange={(e) =>
              onChange(e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </div>
      );
    }
    case CustomFieldType.DATE: {
      const dateVal =
        typeof value === 'string' ? value.slice(0, 10) : '';
      return (
        <div className="space-y-1">
          <label htmlFor={id} className={labelClass}>Value</label>
          <input
            id={id}
            type="date"
            value={dateVal}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
            className={cn(
              'h-9 w-full rounded border border-ink-200 bg-white px-3 text-sm text-ink-900',
              'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200',
              'disabled:cursor-not-allowed disabled:bg-ink-50',
            )}
          />
        </div>
      );
    }
    case CustomFieldType.CHECKBOX: {
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300"
          />
          <label htmlFor={id} className={labelClass}>Checked</label>
        </div>
      );
    }
    case CustomFieldType.SELECT: {
      const strVal = typeof value === 'string' ? value : '';
      return (
        <div className="space-y-1">
          <label htmlFor={id} className={labelClass}>Value</label>
          <Select
            id={id}
            value={strVal}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">— None —</option>
            {field.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </div>
      );
    }
    case CustomFieldType.MULTI_SELECT: {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1">
          <span className={labelClass}>Values</span>
          <div className="space-y-1 rounded border border-ink-200 bg-white p-2">
            {field.options.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={selected.includes(o)}
                  disabled={disabled}
                  onChange={() => {
                    const next = selected.includes(o)
                      ? selected.filter((s) => s !== o)
                      : [...selected, o];
                    onChange(next.length === 0 ? null : next);
                  }}
                  className="h-4 w-4 rounded border-ink-300"
                />
                {o}
              </label>
            ))}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
