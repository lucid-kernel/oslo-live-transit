import { useCallback, useEffect, useState } from 'react';

type Loader<T> = (signal: AbortSignal) => Promise<T>;

interface RequestState<T> {
  load: Loader<T>;
  loading: boolean;
  failed: boolean;
  snapshot: { load: Loader<T>; value: T } | null;
}

/** A stable loader identifies a request scope. Poll only after the previous attempt settles. */
export function useRequest<T>(load: Loader<T> | null, { interval = 0, delay = 0 } = {}) {
  const [state, setState] = useState<RequestState<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    if (!load) {
      setState(null);
      return;
    }

    const request = load;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: number;
    async function run() {
      setState(previous => ({ load: request, loading: true, failed: false, snapshot: previous?.snapshot ?? null }));
      try {
        const value = await request(signal);
        if (!signal.aborted) {
          setState({ load: request, loading: false, failed: false, snapshot: { load: request, value } });
        }
      } catch {
        if (!signal.aborted) {
          setState(previous => ({ load: request, loading: false, failed: true, snapshot: previous?.snapshot ?? null }));
        }
      } finally {
        if (!signal.aborted && interval) timer = window.setTimeout(run, interval);
      }
    }

    if (delay) timer = window.setTimeout(run, delay);
    else void run();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [load, attempt, interval, delay]);

  const snapshot = state?.snapshot;
  return {
    data: snapshot && snapshot.load === load ? snapshot.value : null,
    latest: snapshot?.value ?? null,
    loading: !!load && (state?.load !== load || state.loading),
    failed: !!state && state.load === load && state.failed,
    refresh,
  };
}
