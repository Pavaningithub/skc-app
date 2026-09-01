import { useEffect, useState } from 'react';
import type { Unsubscribe } from 'firebase/firestore';

/**
 * useRealtimeCollection
 *
 * Subscribes to a Firestore collection via an `onSnapshot`-based service method.
 * Returns [data, loading, error]. Automatically unsubscribes on unmount.
 *
 * The error callback matters more than it looks: onSnapshot reports a rejected
 * read (permission denied, for instance) through it and never calls the success
 * callback. Without one, `loading` would stay true forever and the screen would
 * sit on its spinner with nothing to explain why.
 *
 * Usage:
 *   const [orders, loading, error] = useRealtimeCollection(ordersService.subscribe.bind(ordersService));
 */
export function useRealtimeCollection<T>(
  subscribeFn: (cb: (items: T[]) => void, onError?: (err: Error) => void) => Unsubscribe,
): [T[], boolean, Error | null] {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsub = subscribeFn(
      items => {
        setData(items);
        setError(null);
        setLoading(false);
      },
      err => {
        // Surface it and stop loading: a page that renders with one section
        // missing is far more useful than one that never renders at all.
        console.error('[realtime subscription failed]', err);
        setError(err);
        setLoading(false);
      },
    );
    return unsub; // cleanup on unmount
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return [data, loading, error];
}
