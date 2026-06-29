/**
 * NlqlConditionInput — a reusable NLQL condition text field with live
 * validation feedback and smart autocomplete (via NlqlInput).
 * Empty value = unconditional rule.
 */
import { useId } from 'react';
import { validateQuery } from '@next-lane/shared';
import type { CustomFieldDefinitionDto } from '@next-lane/shared';
import { NlqlInput } from '@/components/board/NlqlInput';

export interface NlqlConditionInputProps {
  value: string;
  onChange: (value: string, error: string | null) => void;
  /** Project id — used to fetch labels/users/sprints/components for autocomplete. */
  projectId: string;
  /** Project custom field definitions for NLQL field resolution. */
  customFieldDefs?: Pick<CustomFieldDefinitionDto, 'id' | 'key' | 'name' | 'type'>[];
  /** Statuses for NLQL value suggestions. */
  statuses?: string[];
  /** If true, shows the error state border + message. */
  error?: string | null;
  disabled?: boolean;
  'data-testid'?: string;
}

export function NlqlConditionInput({
  value,
  onChange,
  projectId,
  customFieldDefs = [],
  statuses = [],
  error,
  disabled: _disabled,
  'data-testid': testId = 'automation-condition-input',
}: NlqlConditionInputProps) {
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
      <p className="block text-xs font-semibold text-ink-500" aria-hidden="true">
        Condition{' '}
        <span className="font-normal text-ink-400">(NLQL — leave empty to always run)</span>
      </p>
      <NlqlInput
        value={value}
        onChange={handleChange}
        projectId={projectId}
        customFieldDefs={customFieldDefs}
        statuses={statuses}
        data-testid={testId}
        aria-label="NLQL condition — leave empty to always run"
        aria-invalid={hasError}
        aria-describedby={hasError ? errId : undefined}
        placeholder="priority = HIGH and type = BUG"
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
