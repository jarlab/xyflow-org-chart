import { useEffect, useRef } from 'react';

/**
 * A request to fit the view. `afterVersion` is the layout version current when the request was
 * made: the fit waits for a newer layout (the one the triggering change produces), or fires right
 * away when `afterVersion` is -1.
 */
export interface FitRequest {
  seq: number;
  afterVersion: number;
}

/**
 * Calls `fit` once per request, as soon as `layoutVersion` passes `request.afterVersion`. If no new
 * layout arrives within `fallbackMs` (the change did not move anything), it fits anyway.
 */
export function useFitOnRequest(
  request: FitRequest | null,
  layoutVersion: number,
  fit: () => void,
  fallbackMs = 300,
): void {
  const handledSeq = useRef(0);
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  });

  useEffect(() => {
    if (!request || request.seq === handledSeq.current) return;
    const run = () => {
      handledSeq.current = request.seq;
      fitRef.current();
    };
    if (layoutVersion > request.afterVersion) {
      run();
      return;
    }
    const timer = setTimeout(run, fallbackMs);
    return () => clearTimeout(timer);
  }, [request, layoutVersion, fallbackMs]);
}
