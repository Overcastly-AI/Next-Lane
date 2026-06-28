/**
 * NlqlConditionInput — a reusable NLQL condition text field with live
 * validation feedback. Mirrors the pattern used in CardColorsManager
 * (validateQuery from @next-lane/shared). Empty value = unconditional rule.
 */
import { useId } from 'react';
import { validateQuery } from '@next-lane/shared';
import type { CustomFieldDefinitionDto } from '@next-lane/shared';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

export interface NlqlConditionInputProps {
  value: string;
  onChange: (value: string, error: string | null) => void;
  /** Project custom field definitions for NLQL field resolution. */
  customFieldDefs?: Pick<CustomFieldDefinitionDto, 'id' | 'key' | 'name' | 'type'>[];
  /** If true, shows the error state border + message. */
  error?: string | null;
  disabled?: boolean;
  'data-testid'?: string;
}

export function NlqlConditionInput({
  value,
  onChange,
  customFieldDefs = [],
  error,
  disabled,
  'data-testid': testId = 'automation-condition-input',
}: NlqlConditionInputProps) {
  const inputId = useId();
  const errId = useId();
  const hasError = !!error;

  function handleChange(raw: string) {
    let err: string | null = null;
    if (raw.trim()) {
      const result = validateQuery(raw.trim(), { customFieldDefs });
      if (!result.ok) {
        err = result.error?.message ?? 'Invalid NLQL query';
      }
    }
    onChange(raw, err);
  }

  return (
    <div className="space-y-1">
      <label
        htmlFor={inputId}
        className="block text-xs font-semibold text-ink-500"
      >
        Condition{' '}
        <span className="font-normal text-ink-400">(NLQL — leave empty to always run)</span>
      </label>
      <Input
        id={inputId}
        data-testid={testId}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        placeholder='priority = HIGH and type = BUG'
        spellCheck={false}
        autoComplete="off"
        aria-invalid={hasError}
        aria-describedby={hasError ? errId : undefined}
        className={cn(
          'font-mono text-xs',
          hasError &&
            'border-red-400 focus:border-red-500 focus:ring-red-200',
        )}
      />
      {hasError && (
        <p id={errId} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {!hasError && (
        <p className="text-[11px] text-ink-400">
          Examples: <code className="font-mono">priority = HIGH</code>,{' '}
          <code className="font-mono">assignee = unassigned</code>,{' '}
          <code className="font-mono">type = BUG and status = &quot;In Progress&quot;</code>
        </p>
      )}
    </div>
  );
}
