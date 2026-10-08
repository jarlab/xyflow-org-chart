import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

/** useLayoutEffect in the browser, useEffect on the server. */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const mql = reducedMotionQuery();
  if (!mql) return () => {};
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

/** Live `prefers-reduced-motion: reduce` (false on the server or without matchMedia). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => reducedMotionQuery()?.matches ?? false,
    () => false,
  );
}

export function canAnimate(): boolean {
  return typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
}
