/**
 * groupByDimensions — shared option list + validation for the swimlane
 * group-by dimension picker (`GroupBySelector` on the board toolbar) and the
 * per-board "Default grouping" setting (`BoardSettingsModal`). Kept in one
 * place so the two surfaces can never drift.
 */
import { CustomFieldType, type CustomFieldDefinitionDto } from '@next-lane/shared';
import type { GroupByDimension } from '@/components/board/BoardSwimlanesView';

export interface GroupByOption {
  value: GroupByDimension;
  label: string;
}

/** Core (non-custom-field) group-by dimensions, in menu display order. */
export const CORE_GROUP_BY_OPTIONS: GroupByOption[] = [
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'type', label: 'Issue type' },
  { value: 'epic', label: 'Epic' },
  { value: 'component', label: 'Component' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'label', label: 'Labels' },
];

/**
 * One selectable dimension per project custom SELECT field, labeled by the
 * field's name and encoded as `cf:<fieldId>`. Non-SELECT fields (TEXT,
 * NUMBER, DATE, etc.) don't have a bounded value set, so they're not offered
 * as swimlane dimensions.
 */
export function customFieldGroupByOptions(
  customFieldDefs: CustomFieldDefinitionDto[],
): GroupByOption[] {
  return customFieldDefs
    .filter((d) => d.type === CustomFieldType.SELECT)
    .map((d) => ({ value: `cf:${d.id}` as GroupByDimension, label: d.name }));
}

/** All currently-selectable group-by options (core dimensions + custom SELECT fields). */
export function allGroupByOptions(
  customFieldDefs: CustomFieldDefinitionDto[],
): GroupByOption[] {
  return [...CORE_GROUP_BY_OPTIONS, ...customFieldGroupByOptions(customFieldDefs)];
}

/**
 * True when `raw` (e.g. from the `?group=` URL param or a board's persisted
 * `defaultGroupBy`) is a valid, currently-selectable group-by dimension —
 * either a core dimension key, or `cf:<fieldId>` for a SELECT custom field
 * that still exists on the project.
 */
export function isValidGroupByDimension(
  raw: string,
  customFieldDefs: CustomFieldDefinitionDto[],
): raw is GroupByDimension {
  if (CORE_GROUP_BY_OPTIONS.some((o) => o.value === raw)) return true;
  if (raw.startsWith('cf:')) {
    const id = raw.slice(3);
    return customFieldDefs.some(
      (d) => d.id === id && d.type === CustomFieldType.SELECT,
    );
  }
  return false;
}
