import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('composes conditionals like clsx', () => {
    expect(cn('a', false && 'b', undefined, ['c'], { d: true, e: false })).toBe('a c d');
  });

  it('lets a caller width override a primitive default', () => {
    expect(cn('w-full appearance-none', 'w-28 shrink-0')).toBe('appearance-none w-28 shrink-0');
  });

  it('keeps custom font-size and text color as independent groups', () => {
    expect(cn('text-2xs text-ink-500')).toBe('text-2xs text-ink-500');
    expect(cn('text-sm text-ink-900', 'text-2xs')).toBe('text-ink-900 text-2xs');
    expect(cn('text-ink-900', 'text-signal-600')).toBe('text-signal-600');
  });

  it('keeps custom token shadows distinct from shadow colors, and merges them with each other', () => {
    expect(cn('shadow-modal shadow-ink-200')).toBe('shadow-modal shadow-ink-200');
    expect(cn('shadow-card', 'shadow-cardHover')).toBe('shadow-cardHover');
    expect(cn('shadow-sm', 'shadow-dropdown')).toBe('shadow-dropdown');
  });

  it('keeps custom animation tokens as one group', () => {
    expect(cn('animate-nl-fade-in', 'animate-nl-modal-in')).toBe('animate-nl-modal-in');
    expect(cn('animate-spin', 'animate-nl-fade-in')).toBe('animate-nl-fade-in');
  });

  it('handles custom color scales and opacity modifiers', () => {
    expect(cn('bg-ink-50', 'bg-signal-600')).toBe('bg-signal-600');
    expect(cn('bg-surface', 'bg-canvas')).toBe('bg-canvas');
    expect(cn('border-ink-200', 'border-signal-500')).toBe('border-signal-500');
    expect(cn('border border-ink-200')).toBe('border border-ink-200');
  });

  it('does not drop variants or arbitrary values', () => {
    expect(cn('hover:bg-ink-50 bg-ink-100 dark:bg-ink-900')).toBe('hover:bg-ink-50 bg-ink-100 dark:bg-ink-900');
    expect(cn('duration-[120ms]', 'duration-200')).toBe('duration-200');
    expect(cn('px-3 pr-8', 'px-2')).toBe('px-2');
  });

  it('does not shred arbitrary values that contain spaces (select chevron data-URI)', () => {
    const chevron =
      "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22>')] bg-[length:14px] bg-no-repeat";
    expect(cn('bg-surface', chevron)).toBe(`bg-surface ${chevron}`);
    expect(cn('bg-ink-50 bg-surface', chevron)).toBe(`bg-surface ${chevron}`);
  });
});
