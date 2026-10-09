import { createContext, useContext } from 'react';

/**
 * Board multi-select state, provided by BoardPage and consumed by
 * SortableIssueCard (flat columns AND swimlanes) so selection needs no prop
 * drilling through BoardColumn / BoardSwimlanesView.
 */
export interface BoardSelectionValue {
  /** Explicit "Select" mode (mobile/touch toggle): taps toggle selection. */
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  toggle: (issueId: string) => void;
}

export const BoardSelectionContext = createContext<BoardSelectionValue | null>(
  null,
);

/** Null outside the board (e.g. personal board) — cards then behave as before. */
export function useBoardSelection(): BoardSelectionValue | null {
  return useContext(BoardSelectionContext);
}
