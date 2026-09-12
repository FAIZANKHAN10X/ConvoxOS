'use client';

import { useEffect, useState } from 'react';

/**
 * Client-only wall-clock timestamp (ms since epoch), or null during
 * server prerender / first paint.
 *
 * `Date.now()` in render output makes prerendered HTML
 * non-deterministic: Next.js 16 flags it as an unstable value and
 * it can hydrate-mismatch (e.g. a badge that exists on the client
 * but not in the prerendered shell). Components that display
 * relative time ("5m ago"), staleness badges, or month buckets
 * should render their neutral state while `now` is null and fill
 * in after mount. One tick only — no interval, no re-renders.
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Mount-only clock read: the whole point is to run exclusively
    // on the client, after prerender. Intentionally set-once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, []);
  return now;
}
