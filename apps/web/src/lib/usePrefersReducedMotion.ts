import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Live `prefers-reduced-motion: reduce` state. Used by components that drive
 * their OWN JS animation loop (e.g. `KnowledgeGraphView`'s force-simulation
 * settle-in) where a CSS `motion-safe:`/`motion-reduce:` class isn't enough —
 * unlike CSS-only animations elsewhere in the app, these need to skip doing
 * the incremental work entirely, not just skip rendering the transition.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
