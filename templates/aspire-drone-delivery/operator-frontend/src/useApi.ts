import { useEffect, useState } from 'react';
import { connectRealtime } from './realtime';

export function useRealtimeSnapshot<T>(load: (signal: AbortSignal) => Promise<T>, initial: T) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    function receive(next: T) {
      if (!controller.signal.aborted) { setData(next); setError(''); setLoading(false); }
    }
    connectRealtime<T>('/realtime/operator', 'snapshot', receive,
      async () => receive(await load(controller.signal)), message => { setError(message); setLoading(false); }, controller.signal);
    return () => controller.abort();
  }, [load]);
  return { data, error, loading };
}
