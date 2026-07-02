/**
 * Shared field-key options for the REQUIRE_FIELD workflow gate editor
 * (used by both `WorkflowSection` — legacy project-wide workflow — and
 * `WorkflowsManager` — named per-board workflows).
 *
 * WF-2 fix: the gate editor used to be a freeform text input with a
 * placeholder ("e.g. assigneeId or cf_severity") that steered admins toward
 * typing a value that could never match how custom field values are
 * actually stored (`Issue.customFields` is keyed by the field DEFINITION's
 * opaque CUID, not its human-facing key/name). Replacing the input with a
 * select of known-good options — the backend's core fields plus the
 * project's real custom field definitions (value = the field's stable
 * `key`, which `WorkflowService.evaluateGate` now resolves to the
 * definition id at evaluation time) — makes it impossible to type an
 * unusable value.
 */
import type { CustomFieldDefinitionDto } from '@next-lane/shared';

export interface GateFieldOption {
  value: string;
  label: string;
}

/**
 * Core (non-custom) fields the REQUIRE_FIELD gate supports today. Must stay
 * in sync with `WorkflowService.evaluateGate`'s `coreFields` map.
 */
export const CORE_GATE_FIELD_OPTIONS: GateFieldOption[] = [
  { value: 'assignee', label: 'Assignee' },
  { value: 'description', label: 'Description' },
  { value: 'storyPoints', label: 'Story points' },
  { value: 'dueDate', label: 'Due date' },
];

/** Build the full option list: core fields + the project's custom fields. */
export function buildGateFieldOptions(
  customFields: CustomFieldDefinitionDto[] | undefined,
): GateFieldOption[] {
  const customOptions: GateFieldOption[] = (customFields ?? []).map((f) => ({
    value: f.key,
    label: f.name,
  }));
  return [...CORE_GATE_FIELD_OPTIONS, ...customOptions];
}
