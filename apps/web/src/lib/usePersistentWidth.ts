/**
 * A panel width that survives reload, clamped to a sane range.
 *
 * Separate from `ResizeHandle` because the handle should stay a dumb
 * controlled input — the persistence policy (which key, what bounds, what to
 * do with a corrupt stored value) belongs to the surface that owns the panel.
 */
import { useCallback, useState } from 'react';

export function usePersistentWidth(
  storageKey: string,
  fallback: number,
  min: number,
  max: number,
): [number, (next: number) => void] {
  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, Math.round(n))),
    [min, max],
  );

  const [width, setWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return fallback;
      const parsed = Number(raw);
      // Clamp rather than trust: a stored width from an older build with
      // different bounds — or a hand-edited value — must not be able to
      // render the panel at 4px or wider than the viewport, with no way back.
      return Number.isFinite(parsed) ? clamp(parsed) : fallback;
    } catch {
      // localStorage throws in private mode / when disabled. A resize that
      // can't be remembered is fine; a page that won't render is not.
      return fallback;
    }
  });

  const update = useCallback(
    (next: number) => {
      const value = clamp(next);
      setWidth(value);
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // Non-fatal, same reasoning as above.
      }
    },
    [storageKey, clamp],
  );

  return [width, update];
}
