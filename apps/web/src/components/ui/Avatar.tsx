import type { UserDto } from '@next-lane/shared';
import { cn } from '@/lib/cn';

export interface AvatarProps {
  user?: Pick<UserDto, 'name' | 'avatarColor'> | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  title?: string;
}

const sizes = {
  xs: 'h-5 w-5 text-[7px]',
  sm: 'h-6 w-6 text-[8px]',
  md: 'h-8 w-8 text-[10px]',
};

export function Avatar({ user, size = 'sm', className, title }: AvatarProps) {
  if (!user) {
    return (
      <span
        title={title ?? 'Unassigned'}
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-dashed border-ink-300 bg-ink-50 text-ink-400',
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
        'inline-flex items-center justify-center rounded-full font-bold uppercase ring-2 ring-surface',
        sizes[size],
        className,
      )}
      style={{ backgroundColor: user.avatarColor, color: readableOn(user.avatarColor) }}
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

/** Relative luminance (WCAG 2.x) of a #rrggbb colour; null if unparsable. */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

const DARK_INK = '#000000';
const DARK_INK_LUM = luminance(DARK_INK) ?? 0;

/**
 * Initials colour with the higher WCAG contrast on the avatar fill. Avatar
 * fills are user-chosen mid-tone hues (amber, orange, cyan...) where fixed
 * white text measured 2.3:1.
 */
export function readableOn(bg: string): string {
  const l = luminance(bg);
  if (l === null) return '#ffffff';
  const white = 1.05 / (l + 0.05);
  const dark = (l + 0.05) / (DARK_INK_LUM + 0.05);
  return dark > white ? DARK_INK : '#ffffff';
}
