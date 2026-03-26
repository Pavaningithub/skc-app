import { useEffect, useState } from 'react';
import type { Unsubscribe } from 'firebase/firestore';

/**
 * useRealtimeCollection
 *
 * Subscribes to a Firestore collection via an `onSnapshot`-based service method.
 * Returns [data, loading]. Automatically unsubscribes on unmount.
 *
 * Usage:
 *   const [orders, loading] = useRealtimeCollection(ordersService.subscribe.bind(ordersService));
 */
export function useRealtimeCollection<T>(
  subscribeFn: (cb: (items: T[]) => void) => Unsubscribe,
): [T[], boolean] {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeFn(items => {
      setData(items);
      setLoading(false);
    });
    return unsub; // cleanup on unmount
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return [data, loading];
}
