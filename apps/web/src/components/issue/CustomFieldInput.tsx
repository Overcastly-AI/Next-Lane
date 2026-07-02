/**
 * CustomFieldInput
 *
 * Renders the appropriate control for a single custom field definition. The
 * caller is responsible for providing the current value and an onChange handler.
 * Each variant has a `data-testid` keyed by the field's stable `key` property.
 */
import { type ChangeEvent } from 'react';
import { CustomFieldType, type CustomFieldDefinitionDto, type CustomFieldValue } from '@/api/custom-fields';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';

export interface CustomFieldInputProps {
  definition: CustomFieldDefinitionDto;
  value: CustomFieldValue;
  onChange: (value: CustomFieldValue) => void;
  disabled?: boolean;
}

export function CustomFieldInput({
  definition,
  value,
  onChange,
  disabled = false,
}: CustomFieldInputProps) {
  const testId = `custom-field-input-${definition.key}`;
  const label = (
    <>
      {definition.name}
      {definition.required && (
        <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
      )}
    </>
  );

  switch (definition.type) {
    case CustomFieldType.TEXT: {
      return (
        <Field label={label} htmlFor={testId}>
          <Input
            id={testId}
            data-testid={testId}
            type="text"
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            required={definition.required}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange(e.target.value || null)
            }
          />
        </Field>
      );
    }

    case CustomFieldType.URL: {
      return (
        <Field label={label} htmlFor={testId}>
          <Input
            id={testId}
            data-testid={testId}
            type="url"
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            required={definition.required}
            placeholder="https://…"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange(e.target.value || null)
            }
          />
        </Field>
      );
    }

    case CustomFieldType.NUMBER: {
      return (
        <Field label={label} htmlFor={testId}>
          <Input
            id={testId}
            data-testid={testId}
            type="number"
            value={typeof value === 'number' ? String(value) : ''}
            disabled={disabled}
            required={definition.required}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const raw = e.target.value;
              onChange(raw === '' ? null : Number(raw));
            }}
          />
        </Field>
      );
    }

    case CustomFieldType.DATE: {
      const dateValue =
        typeof value === 'string' ? value.slice(0, 10) : '';
      return (
        <Field label={label} htmlFor={testId}>
          <input
            id={testId}
            data-testid={testId}
            type="date"
            value={dateValue}
            disabled={disabled}
            required={definition.required}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange(e.target.value || null)
            }
            className="rounded-md border border-slate-200 bg-surface px-2 py-1 text-sm text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </Field>
      );
    }

    case CustomFieldType.CHECKBOX: {
      const checked = value === true;
      return (
        <Field label={label} htmlFor={testId}>
          <div className="flex items-center gap-2 py-0.5">
            <input
              id={testId}
              data-testid={testId}
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onChange(e.target.checked)
              }
              className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-500 focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-slate-600">
              {checked ? 'Yes' : 'No'}
            </span>
          </div>
        </Field>
      );
    }

    case CustomFieldType.SELECT: {
      const strVal = typeof value === 'string' ? value : '';
      return (
        <Field label={label} htmlFor={testId}>
          <select
            id={testId}
            data-testid={testId}
            value={strVal}
            disabled={disabled}
            required={definition.required}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              onChange(e.target.value || null)
            }
            className="w-full rounded-md border border-slate-200 bg-surface px-2 py-1.5 text-sm text-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!definition.required && <option value="">— None —</option>}
            {definition.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </Field>
      );
    }

    case CustomFieldType.MULTI_SELECT: {
      const selected: string[] = Array.isArray(value) ? value : [];
      const toggle = (opt: string) => {
        const next = selected.includes(opt)
          ? selected.filter((s) => s !== opt)
          : [...selected, opt];
        onChange(next.length === 0 ? null : next);
      };
      return (
        <Field label={label} htmlFor={`${testId}-0`}>
          <div
            data-testid={testId}
            className="flex flex-col gap-1 rounded-md border border-slate-200 bg-surface px-2 py-2"
          >
            {definition.options.length === 0 ? (
              <span className="text-xs text-slate-400">No options defined</span>
            ) : (
              definition.options.map((opt, i) => (
                <label
                  key={opt}
                  className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    id={i === 0 ? `${testId}-0` : undefined}
                    type="checkbox"
                    checked={selected.includes(opt)}
                    disabled={disabled}
                    onChange={() => toggle(opt)}
                    className="h-4 w-4 rounded border-slate-300 accent-brand-500 focus:ring-2 focus:ring-brand-400 disabled:cursor-not-allowed"
                  />
                  {opt}
                </label>
              ))
            )}
            {selected.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {selected.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700"
                  >
                    {s}
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`Remove ${s}`}
                        onClick={() => toggle(s)}
                        className="ml-0.5 rounded-full p-0.5 hover:bg-brand-200 focus:outline-none"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                          <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                        </svg>
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Field>
      );
    }

    default:
      return null;
  }
}
