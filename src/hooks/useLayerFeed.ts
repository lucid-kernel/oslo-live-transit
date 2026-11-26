import { useMemo } from 'react';
import { useRequest } from './useRequest.ts';

export function useLayerFeed<T>(load: ((signal: AbortSignal) => Promise<T[]>) | null, interval: number) {
  const { data, failed } = useRequest(load, { interval, delay: 200 });
  return useMemo(() => failed ? { rows: [], failed } : data && { rows: data, failed }, [data, failed]);
}
