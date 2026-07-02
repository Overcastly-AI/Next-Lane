/**
 * BoardSwimlanesView — renders the board as horizontal swimlanes when a
 * group-by dimension is active.
 *
 * Each lane is an independent DndContext so drags are always scoped to the
 * lane; cross-lane drops (which would change assignee/priority/etc.) are
 * intentionally OUT OF SCOPE for v1 and are prevented structurally.
 *
 * Design system: Dispatch ink-* tokens, Space Grotesk headings, signal-600
 * accent for "in-motion" affordances, eucalyptus for done. Lane headers use
 * a muted ink-100 band that reads as a structural divider without being heavy.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState } from 'react';
import { IssueType, Priority, type IssueDto, type StatusDto } from '@next-lane/shared';
import type {
  BoardColorRule,
  CustomFieldDefinitionDto,
  EvalContext,
  SprintDto,
  UserDto,
} from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import { BoardColumn } from './BoardColumn';
import { IssueCard } from './IssueCard';
import { cn } from '@/lib/cn';
import { EditableSafeKeyboardSensor } from '@/lib/dndSensors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Core (non-custom-field) swimlane group-by dimension keys. */
export type CoreGroupByDimension =
  | 'assignee'
  | 'priority'
  | 'type'
  | 'epic'
  | 'component'
  | 'label'
  | 'sprint';

/**
 * A project custom SELECT field as a group-by dimension, encoded as
 * `cf:<CustomFieldDefinition.id>` so it round-trips through the `?group=`
 * URL param and the board's persisted `defaultGroupBy` the same way core
 * dimensions do.
 */
export type CustomFieldGroupByDimension = `cf:${string}`;

export type GroupByDimension = CoreGroupByDimension | CustomFieldGroupByDimension;

/** Extracts the custom field id from a `cf:<id>` dimension, or null otherwise. */
export function customFieldIdFromDimension(
  dimension: GroupByDimension,
): string | null {
  return dimension.startsWith('cf:') ? dimension.slice(3) : null;
}

export interface SwimLane {
  id: string;
  label: string;
  /**
   * Optional hex color for a small dot next to the lane label — used for
   * label lanes (label color) where the dimension's values carry color.
   */
  color?: string;
  /** Issues pre-grouped by the dimension (all statuses combined for this lane). */
  issues: IssueDto[];
}

// ---------------------------------------------------------------------------
// Priority display order and labels
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Priority[] = [
  Priority.HIGHEST,
  Priority.HIGH,
  Priority.MEDIUM,
  Priority.LOW,
  Priority.LOWEST,
];

const PRIORITY_LABELS: Record<Priority, string> = {
  [Priority.HIGHEST]: 'Highest',
  [Priority.HIGH]: 'High',
  [Priority.MEDIUM]: 'Medium',
  [Priority.LOW]: 'Low',
  [Priority.LOWEST]: 'Lowest',
};

const TYPE_LABELS: Record<IssueType, string> = {
  [IssueType.TASK]: 'Task',
  [IssueType.BUG]: 'Bug',
  [IssueType.STORY]: 'Story',
  [IssueType.EPIC]: 'Epic',
  [IssueType.SUBTASK]: 'Subtask',
};

// ---------------------------------------------------------------------------
// computeLanes — pure function, call from useMemo in parent or inline
// ---------------------------------------------------------------------------

export function computeLanes(
  dimension: GroupByDimension,
  issuesByStatus: Map<string, IssueDto[]>,
  users: UserDto[],
  extra: {
    sprints?: SprintDto[];
    customFieldDefs?: CustomFieldDefinitionDto[];
  } = {},
): SwimLane[] {
  // Collect ALL filtered issues from the pre-filtered issuesByStatus map.
  const allIssues: IssueDto[] = [];
  for (const arr of issuesByStatus.values()) {
    allIssues.push(...arr);
  }

  // Custom SELECT field dimensions (`cf:<fieldId>`) are computed generically
  // from the field's option list rather than a hardcoded case below.
  const customFieldId = customFieldIdFromDimension(dimension);
  if (customFieldId) {
    return computeCustomFieldLanes(customFieldId, allIssues, extra.customFieldDefs ?? []);
  }

  switch (dimension as CoreGroupByDimension) {
    case 'assignee': {
      // Group by assigneeId. Unassigned issues get a synthetic lane.
      const byAssignee = new Map<string | null, IssueDto[]>();
      byAssignee.set(null, []); // "Unassigned" lane always first
      for (const issue of allIssues) {
        const key = issue.assigneeId;
        if (!byAssignee.has(key)) byAssignee.set(key, []);
        byAssignee.get(key)!.push(issue);
      }
      const lanes: SwimLane[] = [];
      // Non-null assignees first, sorted by name.
      const assigneeIds = [...byAssignee.keys()].filter((k): k is string => k !== null);
      const sorted = assigneeIds.sort((a, b) => {
        const na = users.find((u) => u.id === a)?.name ?? '';
        const nb = users.find((u) => u.id === b)?.name ?? '';
        return na.localeCompare(nb);
      });
      for (const id of sorted) {
        const issues = byAssignee.get(id) ?? [];
        if (issues.length === 0) continue;
        const user = users.find((u) => u.id === id);
        lanes.push({ id, label: user?.name ?? 'Unknown', issues });
      }
      // Unassigned lane at end.
      const unassigned = byAssignee.get(null) ?? [];
      if (unassigned.length > 0) {
        lanes.push({ id: '__unassigned__', label: 'Unassigned', issues: unassigned });
      }
      return lanes;
    }

    case 'priority': {
      const byPriority = new Map<Priority, IssueDto[]>();
      for (const p of PRIORITY_ORDER) byPriority.set(p, []);
      for (const issue of allIssues) {
        byPriority.get(issue.priority)?.push(issue);
      }
      return PRIORITY_ORDER.filter((p) => (byPriority.get(p) ?? []).length > 0).map(
        (p) => ({
          id: p,
          label: PRIORITY_LABELS[p],
          issues: byPriority.get(p) ?? [],
        }),
      );
    }

    case 'type': {
      const byType = new Map<IssueType, IssueDto[]>();
      for (const issue of allIssues) {
        if (!byType.has(issue.type)) byType.set(issue.type, []);
        byType.get(issue.type)!.push(issue);
      }
      // Preserve type order as defined.
      const typeOrder: IssueType[] = [
        IssueType.EPIC,
        IssueType.STORY,
        IssueType.TASK,
        IssueType.BUG,
        IssueType.SUBTASK,
      ];
      return typeOrder
        .filter((t) => (byType.get(t) ?? []).length > 0)
        .map((t) => ({
          id: t,
          label: TYPE_LABELS[t],
          issues: byType.get(t) ?? [],
        }));
    }

    case 'epic': {
      // Group by parentId. Issues with a parent whose type=EPIC land in that
      // epic's lane. Issues with no parent (or a non-epic parent) land in
      // the "No epic" lane.
      const byEpic = new Map<string, IssueDto[]>();
      const epicMeta = new Map<string, { key: string; title: string }>();
      const noEpic: IssueDto[] = [];

      for (const issue of allIssues) {
        const parent = issue.parent;
        if (parent && parent.type === IssueType.EPIC) {
          if (!byEpic.has(parent.id)) byEpic.set(parent.id, []);
          byEpic.get(parent.id)!.push(issue);
          if (!epicMeta.has(parent.id)) {
            epicMeta.set(parent.id, { key: parent.key, title: parent.title });
          }
        } else {
          noEpic.push(issue);
        }
      }

      const lanes: SwimLane[] = [];
      // Sort epics by their key.
      const epicIds = [...byEpic.keys()].sort((a, b) => {
        const ka = epicMeta.get(a)?.key ?? '';
        const kb = epicMeta.get(b)?.key ?? '';
        return ka.localeCompare(kb);
      });
      for (const id of epicIds) {
        const meta = epicMeta.get(id)!;
        const issues = byEpic.get(id) ?? [];
        if (issues.length === 0) continue;
        lanes.push({ id, label: `${meta.key}: ${meta.title}`, issues });
      }
      if (noEpic.length > 0) {
        lanes.push({ id: '__no_epic__', label: 'No epic', issues: noEpic });
      }
      return lanes;
    }

    case 'component': {
      // Group by componentId. Issues with no component land in "No component".
      const byComponent = new Map<string, IssueDto[]>();
      const names = new Map<string, string>();
      const noComponent: IssueDto[] = [];

      for (const issue of allIssues) {
        if (issue.componentId && issue.component) {
          if (!byComponent.has(issue.componentId)) byComponent.set(issue.componentId, []);
          byComponent.get(issue.componentId)!.push(issue);
          names.set(issue.componentId, issue.component.name);
        } else {
          noComponent.push(issue);
        }
      }

      const lanes: SwimLane[] = [];
      const ids = [...byComponent.keys()].sort((a, b) =>
        (names.get(a) ?? '').localeCompare(names.get(b) ?? ''),
      );
      for (const id of ids) {
        lanes.push({ id, label: names.get(id)!, issues: byComponent.get(id)! });
      }
      if (noComponent.length > 0) {
        lanes.push({ id: '__no_component__', label: 'No component', issues: noComponent });
      }
      return lanes;
    }

    case 'label': {
      // One lane per label; an issue with N labels appears in N lanes (matches
      // the existing multi-label-filter mental model elsewhere in the app —
      // cross-lane DnD stays out of scope so duplicate membership is safe).
      // Issues with zero labels land in a single "No labels" lane.
      const byLabel = new Map<string, IssueDto[]>();
      const meta = new Map<string, { name: string; color: string }>();
      const noLabel: IssueDto[] = [];

      for (const issue of allIssues) {
        const labels = issue.labels ?? [];
        if (labels.length === 0) {
          noLabel.push(issue);
          continue;
        }
        for (const label of labels) {
          if (!byLabel.has(label.id)) byLabel.set(label.id, []);
          byLabel.get(label.id)!.push(issue);
          meta.set(label.id, { name: label.name, color: label.color });
        }
      }

      const lanes: SwimLane[] = [];
      const ids = [...byLabel.keys()].sort((a, b) =>
        (meta.get(a)?.name ?? '').localeCompare(meta.get(b)?.name ?? ''),
      );
      for (const id of ids) {
        const m = meta.get(id)!;
        lanes.push({ id, label: m.name, color: m.color, issues: byLabel.get(id)! });
      }
      if (noLabel.length > 0) {
        lanes.push({ id: '__no_label__', label: 'No labels', issues: noLabel });
      }
      return lanes;
    }

    case 'sprint': {
      // Group by sprintId. Issues with no sprint (backlog) land in "No sprint".
      const sprints = extra.sprints ?? [];
      const bySprint = new Map<string, IssueDto[]>();
      const noSprint: IssueDto[] = [];

      for (const issue of allIssues) {
        if (issue.sprintId) {
          if (!bySprint.has(issue.sprintId)) bySprint.set(issue.sprintId, []);
          bySprint.get(issue.sprintId)!.push(issue);
        } else {
          noSprint.push(issue);
        }
      }

      const lanes: SwimLane[] = [];
      const ids = [...bySprint.keys()].sort((a, b) => {
        const na = sprints.find((s) => s.id === a)?.name ?? '';
        const nb = sprints.find((s) => s.id === b)?.name ?? '';
        return na.localeCompare(nb);
      });
      for (const id of ids) {
        const name = sprints.find((s) => s.id === id)?.name ?? 'Unknown sprint';
        lanes.push({ id, label: name, issues: bySprint.get(id)! });
      }
      if (noSprint.length > 0) {
        lanes.push({ id: '__no_sprint__', label: 'No sprint', issues: noSprint });
      }
      return lanes;
    }
  }
}

/**
 * Lanes for a custom SELECT field dimension (`cf:<fieldId>`): one lane per
 * option value actually in use (in the field's configured option order),
 * followed by any stale values (an option later removed from the field
 * definition, so existing issue values still surface instead of vanishing),
 * followed by a "None" lane for issues with no value set. Pure — takes the
 * field's option list as data rather than looking anything up globally.
 */
function computeCustomFieldLanes(
  fieldId: string,
  allIssues: IssueDto[],
  customFieldDefs: CustomFieldDefinitionDto[],
): SwimLane[] {
  const def = customFieldDefs.find((d) => d.id === fieldId);
  const optionOrder = def?.options ?? [];

  const byValue = new Map<string, IssueDto[]>();
  const none: IssueDto[] = [];

  for (const issue of allIssues) {
    const raw = issue.customFields?.[fieldId];
    const value = typeof raw === 'string' && raw.trim() !== '' ? raw : null;
    if (value === null) {
      none.push(issue);
      continue;
    }
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value)!.push(issue);
  }

  const lanes: SwimLane[] = [];
  for (const opt of optionOrder) {
    const issues = byValue.get(opt);
    if (issues && issues.length > 0) {
      lanes.push({ id: opt, label: opt, issues });
      byValue.delete(opt);
    }
  }
  // Values still present on issues but no longer in the field's option list.
  const stale = [...byValue.keys()].sort((a, b) => a.localeCompare(b));
  for (const value of stale) {
    lanes.push({ id: value, label: value, issues: byValue.get(value)! });
  }
  if (none.length > 0) {
    lanes.push({ id: '__none__', label: 'None', issues: none });
  }
  return lanes;
}

// ---------------------------------------------------------------------------
// SingleLane — one swimlane row (its own DndContext for isolation)
// ---------------------------------------------------------------------------

function SingleLane({
  lane,
  statuses,
  issuesByStatus,
  editable,
  onAdd,
  onOpenIssue,
  onStatusChange,
  colorRules,
  colorCtx,
  onMove,
  neighborsUnchanged,
}: {
  lane: SwimLane;
  statuses: StatusDto[];
  /** The pre-filtered issuesByStatus for this lane's issues only. */
  issuesByStatus: Map<string, IssueDto[]>;
  editable: boolean;
  onAdd: (statusId: string) => void;
  onOpenIssue: (id: string) => void;
  onStatusChange: (issueId: string, statusId: string) => void;
  colorRules?: BoardColorRule[];
  colorCtx?: EvalContext;
  onMove: (params: {
    id: string;
    statusId: string;
    beforeId: string | null;
    afterId: string | null;
  }) => void;
  neighborsUnchanged: (
    ordered: IssueDto[],
    activeId: string,
    beforeId: string | null,
    afterId: string | null,
  ) => boolean;
}) {
  const [activeIssue, setActiveIssue] = useState<IssueDto | null>(null);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(EditableSafeKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const noSensors = useSensors();
  const sensors = editable ? dragSensors : noSensors;

  function onDragStart(event: DragStartEvent) {
    // Only pick up issues that belong to this lane.
    const issue = lane.issues.find((i) => i.id === event.active.id);
    setActiveIssue(issue ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveIssue(null);
    const { active, over } = event;
    if (!editable || !over) return;

    const activeId = String(active.id);
    // Verify the dragged card belongs to this lane (safety guard).
    const dragged = lane.issues.find((i) => i.id === activeId);
    if (!dragged) return;

    const overData = over.data.current as
      | { type?: string; statusId?: string }
      | undefined;
    const overIsColumn = overData?.type === 'column';
    const targetStatusId = overIsColumn
      ? String(over.id)
      : (overData?.statusId ?? dragged.statusId);

    const column = (issuesByStatus.get(targetStatusId) ?? []).filter(
      (i) => i.id !== activeId,
    );

    let insertIndex: number;
    if (overIsColumn) {
      insertIndex = column.length;
    } else {
      const overIndex = column.findIndex((i) => i.id === String(over.id));
      insertIndex = overIndex === -1 ? column.length : overIndex;
    }

    const beforeIssue = column[insertIndex - 1] ?? null;
    const afterIssue = column[insertIndex] ?? null;

    if (
      targetStatusId === dragged.statusId &&
      neighborsUnchanged(
        issuesByStatus.get(targetStatusId) ?? [],
        activeId,
        beforeIssue?.id ?? null,
        afterIssue?.id ?? null,
      )
    ) {
      return;
    }

    onMove({
      id: activeId,
      statusId: targetStatusId,
      beforeId: beforeIssue?.id ?? null,
      afterId: afterIssue?.id ?? null,
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveIssue(null)}
    >
      <div className="nl-scroll flex overflow-x-auto px-4 pb-3 pt-2 gap-0">
        {statuses.map((status, idx) => (
          <div key={status.id} className="flex items-stretch gap-0">
            {idx > 0 && <div className="nl-lane-divider mx-2" aria-hidden="true" />}
            <BoardColumn
              status={status}
              issues={issuesByStatus.get(status.id) ?? []}
              statuses={statuses}
              editable={editable}
              onAdd={onAdd}
              onOpenIssue={onOpenIssue}
              onStatusChange={onStatusChange}
              colorRules={colorRules}
              colorCtx={colorCtx}
            />
          </div>
        ))}
      </div>

      <DragOverlay>
        {activeIssue ? <IssueCard issue={activeIssue} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// LaneHeader — accessible, Dispatch-styled group label
// ---------------------------------------------------------------------------

function LaneHeader({
  lane,
  dimension,
  users,
}: {
  lane: SwimLane;
  dimension: GroupByDimension;
  users: UserDto[];
}) {
  const assignee =
    dimension === 'assignee' && lane.id !== '__unassigned__'
      ? users.find((u) => u.id === lane.id)
      : null;

  return (
    <div
      data-testid="swimlane-lane-header"
      className={cn(
        'flex items-center gap-2.5 px-4 py-2',
        'border-b border-ink-200 bg-ink-50',
      )}
      role="rowheader"
    >
      {assignee && (
        <Avatar user={assignee} size="sm" />
      )}
      {lane.color && (
        <span
          aria-hidden="true"
          data-testid="swimlane-lane-color-dot"
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: lane.color }}
        />
      )}
      <h2
        className="font-display text-[11px] font-bold uppercase tracking-[0.1em] text-ink-600"
        aria-label={`${lane.label} group`}
      >
        {lane.label}
      </h2>
      <span
        className="nl-data-chip rounded-sm bg-ink-200 px-1.5 py-0.5 text-ink-600"
        aria-label={`${lane.issues.length} issues`}
      >
        {lane.issues.length}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BoardSwimlanesView — main export
// ---------------------------------------------------------------------------

export function BoardSwimlanesView({
  lanes,
  dimension,
  statuses,
  issuesByStatus,
  users,
  editable,
  onAdd,
  onOpenIssue,
  onStatusChange,
  colorRules,
  colorCtx,
  onMove,
  neighborsUnchanged,
}: {
  lanes: SwimLane[];
  dimension: GroupByDimension;
  statuses: StatusDto[];
  /**
   * The FULL filtered issuesByStatus map (all lanes). We slice it per-lane
   * inside this component so each lane's DndContext only sees its own issues.
   */
  issuesByStatus: Map<string, IssueDto[]>;
  users: UserDto[];
  editable: boolean;
  onAdd: (statusId: string) => void;
  onOpenIssue: (id: string) => void;
  onStatusChange: (issueId: string, statusId: string) => void;
  colorRules?: BoardColorRule[];
  colorCtx?: EvalContext;
  onMove: (params: {
    id: string;
    statusId: string;
    beforeId: string | null;
    afterId: string | null;
  }) => void;
  neighborsUnchanged: (
    ordered: IssueDto[],
    activeId: string,
    beforeId: string | null,
    afterId: string | null,
  ) => boolean;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto" role="table" aria-label="Board swimlanes">
      {lanes.map((lane) => {
        // Build a per-lane issuesByStatus map so each lane's DndContext is
        // isolated to only the issues in that lane.
        const laneIssueSet = new Set(lane.issues.map((i) => i.id));
        const laneIssuesByStatus = new Map<string, IssueDto[]>();
        for (const status of statuses) {
          laneIssuesByStatus.set(
            status.id,
            (issuesByStatus.get(status.id) ?? []).filter((i) => laneIssueSet.has(i.id)),
          );
        }

        return (
          <div
            key={lane.id}
            data-testid="swimlane-lane"
            role="row"
            className={cn(
              'border-b border-ink-200',
              'last:border-b-0',
            )}
          >
            <LaneHeader lane={lane} dimension={dimension} users={users} />
            <SingleLane
              lane={lane}
              statuses={statuses}
              issuesByStatus={laneIssuesByStatus}
              editable={editable}
              onAdd={onAdd}
              onOpenIssue={onOpenIssue}
              onStatusChange={onStatusChange}
              colorRules={colorRules}
              colorCtx={colorCtx}
              onMove={onMove}
              neighborsUnchanged={neighborsUnchanged}
            />
          </div>
        );
      })}

      {lanes.length === 0 && (
        <div className="flex flex-1 items-center justify-center py-16 text-sm text-ink-400">
          No issues match the current filters.
        </div>
      )}
    </div>
  );
}
