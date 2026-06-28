/**
 * NLQL standard-field allowlist.
 *
 * This is the single source of truth for which bare (unquoted) field names are
 * valid and how they map onto canonical IssueDto-derived fields. Anything not
 * in this map (and not a registered custom field) is rejected at validation
 * time — there is NO dynamic property access on the issue object.
 */

/** Canonical, allowlisted standard field identifiers. */
export type StandardField =
  | 'status'
  | 'statusCategory'
  | 'assignee'
  | 'reporter'
  | 'type'
  | 'priority'
  | 'labels'
  | 'sprint'
  | 'dueDate'
  | 'createdAt'
  | 'updatedAt'
  | 'title'
  | 'text'
  | 'storyPoints'
  | 'key'
  | 'parentId'
  | 'componentId';

/** The value-kind of a standard field, used to pick comparison semantics. */
export type FieldKind =
  | 'enum' // case-insensitive string match against a fixed vocabulary
  | 'user' // resolves ids / me() / name / email
  | 'string' // free text, case-insensitive compare, `~` = substring
  | 'number'
  | 'date'
  | 'array' // membership semantics for `=`/IN, substring for `~`
  | 'id'; // opaque id string, exact match only

export interface StandardFieldMeta {
  field: StandardField;
  kind: FieldKind;
}

/**
 * Alias → canonical field map. Keys are lower-cased; lookups lower-case the
 * incoming token so matching is case-insensitive.
 */
const ALIASES: Record<string, StandardFieldMeta> = {
  status: { field: 'status', kind: 'enum' },
  statuscategory: { field: 'statusCategory', kind: 'enum' },
  'status.category': { field: 'statusCategory', kind: 'enum' },
  category: { field: 'statusCategory', kind: 'enum' },

  assignee: { field: 'assignee', kind: 'user' },
  reporter: { field: 'reporter', kind: 'user' },

  type: { field: 'type', kind: 'enum' },
  issuetype: { field: 'type', kind: 'enum' },

  priority: { field: 'priority', kind: 'enum' },

  label: { field: 'labels', kind: 'array' },
  labels: { field: 'labels', kind: 'array' },

  sprint: { field: 'sprint', kind: 'id' },

  duedate: { field: 'dueDate', kind: 'date' },
  due: { field: 'dueDate', kind: 'date' },

  createdat: { field: 'createdAt', kind: 'date' },
  created: { field: 'createdAt', kind: 'date' },

  updatedat: { field: 'updatedAt', kind: 'date' },
  updated: { field: 'updatedAt', kind: 'date' },

  title: { field: 'title', kind: 'string' },
  summary: { field: 'title', kind: 'string' },

  text: { field: 'text', kind: 'string' },

  storypoints: { field: 'storyPoints', kind: 'number' },
  points: { field: 'storyPoints', kind: 'number' },

  key: { field: 'key', kind: 'id' },

  parentid: { field: 'parentId', kind: 'id' },
  parent: { field: 'parentId', kind: 'id' },

  componentid: { field: 'componentId', kind: 'id' },
  component: { field: 'componentId', kind: 'id' },
};

/**
 * Resolve a bare field token to its canonical metadata, or `undefined` if it is
 * not a known standard field. The lookup is a fixed-key map access (no dynamic
 * property access on user-controlled objects), so it cannot be used for
 * prototype pollution: `__proto__`, `constructor`, etc. simply miss the map.
 */
export function resolveStandardField(name: string): StandardFieldMeta | undefined {
  const key = name.toLowerCase();
  // Object.prototype.hasOwnProperty guard so inherited keys (e.g. "constructor",
  // "toString") never resolve to a function on the prototype chain.
  if (!Object.prototype.hasOwnProperty.call(ALIASES, key)) return undefined;
  return ALIASES[key];
}

/** True if the bare name is an allowlisted standard field (any alias). */
export function isStandardField(name: string): boolean {
  return resolveStandardField(name) !== undefined;
}
