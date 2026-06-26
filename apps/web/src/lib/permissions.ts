import { Role } from '@next-lane/shared';

/**
 * Whether a workspace role may mutate project data (create/edit/delete issues,
 * comments, labels, columns, sprints, drag-and-drop). Mirrors the server-side
 * rule that VIEWER is read-only while MEMBER and ADMIN can write. The API is the
 * source of truth (returns 403); this just keeps the UI from offering actions
 * that would fail. While the role is still loading (`null`/`undefined`) we
 * optimistically allow editing so MEMBER/ADMIN never see a flash of read-only
 * controls — the worst case is an unchanged 403 toast on a race.
 */
export function canEdit(role: Role | null | undefined): boolean {
  return role !== Role.VIEWER;
}
