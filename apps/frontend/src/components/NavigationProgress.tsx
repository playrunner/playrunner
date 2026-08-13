import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePendingApiRequestCount } from '../lib/apiActivity';

const MINIMUM_VISIBLE_MS = 350;
const REQUEST_DISCOVERY_MS = 200;
const FINISH_DURATION_MS = 180;

type ProgressPhase = 'idle' | 'loading' | 'finishing';

export function NavigationProgress() {
  const location = useLocation();
  const pendingRequestCount = usePendingApiRequestCount();
  const locationSignature = `${location.pathname}${location.search}${location.hash}`;
  const previousLocation = useRef(locationSignature);
  const startedAt = useRef(0);
  const [transitionKey, setTransitionKey] = useState(location.key);
  const [phase, setPhase] = useState<ProgressPhase>('idle');

  useLayoutEffect(() => {
    if (previousLocation.current === locationSignature) {
      return;
    }

    previousLocation.current = locationSignature;
    startedAt.current = performance.now();
    setTransitionKey(location.key);
    setPhase('loading');
  }, [location.key, locationSignature]);

  useEffect(() => {
    if (phase === 'loading') {
      if (pendingRequestCount > 0) {
        return;
      }

      const elapsed = performance.now() - startedAt.current;
      const finishDelay = Math.max(
        0,
        MINIMUM_VISIBLE_MS - elapsed,
        REQUEST_DISCOVERY_MS - elapsed,
      );
      const timeout = window.setTimeout(() => {
        setPhase('finishing');
      }, finishDelay);

      return () => window.clearTimeout(timeout);
    }

    if (phase !== 'finishing') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPhase('idle');
    }, FINISH_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, [pendingRequestCount, phase]);

  if (phase === 'idle') {
    return null;
  }

  return (
    <div
      key={transitionKey}
      className={`navigation-progress fixed inset-x-0 top-0 z-[100] h-0.5 origin-left bg-accent shadow-[0_0_8px_var(--accent)] ${
        phase === 'finishing' ? 'navigation-progress--finishing' : ''
      }`}
      role="progressbar"
      aria-label="Loading page"
    />
  );
}
