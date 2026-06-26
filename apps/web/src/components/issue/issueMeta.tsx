import { IssueType, Priority } from '@next-lane/shared';
import type { ReactElement } from 'react';

/** Small colored square icon per issue type (Jira-like). */
export function IssueTypeIcon({
  type,
  className = 'h-4 w-4',
}: {
  type: IssueType;
  className?: string;
}): ReactElement {
  const map: Record<IssueType, { bg: string; glyph: ReactElement }> = {
    [IssueType.STORY]: {
      bg: '#22c55e',
      glyph: <path d="M7 12l3 3 7-7" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    },
    [IssueType.TASK]: {
      bg: '#3b82f6',
      glyph: <path d="M7 12l3 3 7-7" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    },
    [IssueType.BUG]: {
      bg: '#ef4444',
      glyph: <circle cx="12" cy="12" r="3.5" fill="white" />,
    },
    [IssueType.EPIC]: {
      bg: '#a855f7',
      glyph: <path d="M13 4l-7 9h4l-1 7 7-9h-4z" fill="white" />,
    },
    [IssueType.SUBTASK]: {
      bg: '#6b7280',
      glyph: <path d="M8 8h8v8H8z" fill="white" />,
    },
  };
  const { bg, glyph } = map[type];
  return (
    <span
      title={titleCase(type)}
      className={`inline-flex shrink-0 items-center justify-center rounded ${className}`}
      style={{ backgroundColor: bg }}
    >
      <svg viewBox="0 0 24 24" width="70%" height="70%">
        {glyph}
      </svg>
    </span>
  );
}

const PRIORITY_META: Record<Priority, { color: string; bars: number }> = {
  [Priority.HIGHEST]: { color: '#dc2626', bars: 4 },
  [Priority.HIGH]: { color: '#ef4444', bars: 3 },
  [Priority.MEDIUM]: { color: '#f59e0b', bars: 2 },
  [Priority.LOW]: { color: '#3b82f6', bars: 1 },
  [Priority.LOWEST]: { color: '#6b7280', bars: 1 },
};

export function PriorityIcon({
  priority,
  className = 'h-4 w-4',
}: {
  priority: Priority;
  className?: string;
}): ReactElement {
  const { color, bars } = PRIORITY_META[priority];
  return (
    <span
      title={`${titleCase(priority)} priority`}
      className={`inline-flex shrink-0 items-end gap-[2px] ${className}`}
    >
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className="w-[3px] rounded-sm"
          style={{
            height: `${n * 25}%`,
            backgroundColor: n <= bars ? color : '#e5e7eb',
          }}
        />
      ))}
    </span>
  );
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
