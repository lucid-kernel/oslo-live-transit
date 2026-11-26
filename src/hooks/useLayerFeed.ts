import { useEffect, useState } from 'react';

type Loader<T> = (signal: AbortSignal) => Promise<T[]>;

// Each scope owns its result and timer. A pan or toggle invalidates it immediately.
export function useLayerFeed<T>(load: Loader<T> | null, interval: number) {
  const [result, setResult] = useState<{ load: Loader<T>; rows: T[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (!load) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    let timer: number;
    async function refresh() {
      if (!load || controller.signal.aborted) return;
      try {
        const rows = await load(controller.signal);
        if (!controller.signal.aborted) setResult({ load, rows, failed: false });
      } catch {
        if (!controller.signal.aborted) setResult({ load, rows: [], failed: true });
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, interval);
      }
    }
    timer = window.setTimeout(refresh, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [load, interval]);
  return result && result.load === load ? result : null;
}
