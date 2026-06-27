/**
 * PresenceAvatars — compact stacked-avatar group showing who is currently
 * viewing the same board. Rendered in the board toolbar/header.
 *
 * - Shows up to MAX_VISIBLE avatars then a "+N" overflow badge.
 * - Has an accessible aria-label listing all viewer names.
 * - A tooltip (title) on the group enumerates the names.
 * - Handles 0 viewers gracefully (renders nothing).
 */
import type { PresenceViewer } from '@next-lane/shared';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';

const MAX_VISIBLE = 4;

interface PresenceAvatarsProps {
  viewers: PresenceViewer[];
  className?: string;
}

export function PresenceAvatars({ viewers, className }: PresenceAvatarsProps) {
  if (viewers.length === 0) return null;

  const visible = viewers.slice(0, MAX_VISIBLE);
  const overflow = viewers.length - visible.length;

  const names = viewers.map((v) => v.name).join(', ');
  const ariaLabel =
    viewers.length === 1
      ? `${viewers[0].name} is viewing this board`
      : `${names} are viewing this board`;

  return (
    <div
      data-testid="presence-avatars"
      aria-label={ariaLabel}
      title={names}
      className={cn('flex items-center', className)}
    >
      <div className="flex -space-x-2">
        {visible.map((viewer) => (
          <Avatar
            key={viewer.userId}
            user={{ name: viewer.name, avatarColor: viewer.avatarColor }}
            size="sm"
            title={viewer.name}
            className="ring-2 ring-white"
          />
        ))}
        {overflow > 0 && (
          <span
            aria-label={`and ${overflow} more`}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-full',
              'bg-gray-200 text-[10px] font-semibold text-gray-600',
              'ring-2 ring-white',
            )}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
