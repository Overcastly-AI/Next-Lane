import type { UserDto } from '@next-lane/shared';
import { cn } from '@/lib/cn';

export interface AvatarProps {
  user?: Pick<UserDto, 'name' | 'avatarColor'> | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  title?: string;
}

const sizes = {
  xs: 'h-5 w-5 text-[8px]',
  sm: 'h-6 w-6 text-[9px]',
  md: 'h-8 w-8 text-[11px]',
};

export function Avatar({ user, size = 'sm', className, title }: AvatarProps) {
  if (!user) {
    return (
      <span
        title={title ?? 'Unassigned'}
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-slate-400',
          sizes[size],
          className,
        )}
      >
        ?
      </span>
    );
  }
  return (
    <span
      title={title ?? user.name}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold uppercase text-white ring-2 ring-white',
        sizes[size],
        className,
      )}
      style={{ backgroundColor: user.avatarColor }}
    >
      {initials(user.name)}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '');
}
