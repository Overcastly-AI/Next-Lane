import { describe, expect, it } from 'vitest';
import { readableOn } from './Avatar';

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('readableOn', () => {
  // The API's avatar palette (auth.service.ts COLORS).
  const palette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#a855f7', '#ec4899'];
  it.each(palette)('gives >=4.5:1 initials on %s', (bg) => {
    expect(ratio(bg, readableOn(bg))).toBeGreaterThanOrEqual(4.5);
  });
  it('falls back to white for unparsable colours', () => {
    expect(readableOn('rebeccapurple')).toBe('#ffffff');
  });
});
