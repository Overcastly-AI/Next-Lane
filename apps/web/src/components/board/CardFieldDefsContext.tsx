import { createContext, useContext } from 'react';
import type { CustomFieldDefinitionDto } from '@next-lane/shared';

/**
 * Custom-field definitions flagged `showOnCard` for the current project.
 * Provided once at the board root so every IssueCard (columns, swimlanes, and
 * the drag overlay) can render pinned field chips without prop-drilling through
 * BoardColumn / SortableIssueCard.
 */
const CardFieldDefsContext = createContext<CustomFieldDefinitionDto[]>([]);

export const CardFieldDefsProvider = CardFieldDefsContext.Provider;

export function useCardFieldDefs(): CustomFieldDefinitionDto[] {
  return useContext(CardFieldDefsContext);
}
